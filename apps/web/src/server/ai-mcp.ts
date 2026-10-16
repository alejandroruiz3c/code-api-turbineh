import type { AiApp } from "@turbineh/db";
import type { OrchestrationEngine } from "@turbineh/orchestration";
import { z } from "zod";
import type { RequestMetrics } from "./ai-metrics";
import {
  authenticate,
  type GatewayDeps,
  TRIAL_CONTACT,
  trialBalance,
  trialHeaders,
} from "./ai-gateway";
import {
  chatToOrchestrate,
  DEFAULT_TIMEOUT_MS,
  OrchestrateBody,
  OrchestratedChatBody,
  orchestrateFor,
  usageReport,
} from "./ai-orchestration";

/**
 * Remote MCP server of Intelligence Orchestration (ADR-0059) at /v1/ai/mcp: the Streamable HTTP transport of the
 * Model Context Protocol in its stateless form — each POST carries one JSON-RPC message and gets one JSON answer; no
 * session, no server-sent events. Authenticated with the same `tbh_ai_` app token as the HTTP API, with the same trial
 * cap, rate limit and quota. Implemented in a few lines like the CLI's stdio server (ADR-0036), without the SDK.
 */

/** Protocol revisions this server speaks (newest first); the client's is echoed when supported. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "turbineh-orchestration", version: "1.0.0" };

const INSTRUCTIONS =
  "TurbineH Intelligence Orchestration: send a task and get an orchestrated answer — TurbineH picks the route " +
  "(model and steps) for each request. Use `orchestrate` for one task over an input (pass a JSON Schema in `schema` " +
  "to get JSON that matches it), `chat` for a conversation turn, `trial_status` to see the remaining trial " +
  "balance and `usage_report` for the account's totals (cost, latency, savings against a frontier model). Every " +
  "answer carries structuredContent.metrics: latency_ms, tokens, cost_usd and the frontier reference. When a tool returns trial_limit_reached, tell the user the trial is used up and to contact " +
  `${TRIAL_CONTACT}; do not retry.`;

type Schema = Record<string, unknown>;
interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "orchestrate",
    title: "Orchestrated answer",
    description:
      "Run one task through TurbineH Intelligence Orchestration and get the answer. Describe what to do in `task` " +
      "(e.g. 'Summarize in 3 bullet points', 'Classify the sentiment', 'Extract the invoice fields') and give the " +
      "text or record to process in `input`. Pass a JSON Schema in `schema` to get a JSON answer that matches it " +
      "(returned as text and as structuredContent.answer). Optional `instructions` set tone, language or rules. " +
      "Counts against the trial balance.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to do with the input (max 4000 chars)." },
        input: { type: "string", description: "The text or record to process (max 200000 chars)." },
        schema: {
          type: "object",
          description: "Optional JSON Schema the answer must match (structured output).",
        },
        instructions: {
          type: "string",
          description: "Optional rules for the answer: tone, language, format (max 8000 chars).",
        },
      },
      required: ["task", "input"],
      additionalProperties: false,
    },
  },
  {
    name: "chat",
    title: "Orchestrated chat",
    description:
      "Answer the next turn of a conversation through TurbineH Intelligence Orchestration. `messages` is the " +
      "conversation in order (roles system, user, assistant); the last message must be the user's. Returns the " +
      "assistant's reply. Counts against the trial balance.",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["system", "user", "assistant"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
          description: "The conversation, oldest first; the last message is the user's.",
        },
      },
      required: ["messages"],
      additionalProperties: false,
    },
  },
  {
    name: "usage_report",
    title: "Usage and savings report",
    description:
      "Cumulative measurement of this TurbineH account (all its AI apps): requests, model calls, input/output " +
      "tokens, cost in USD as charged to the trial, p50/p95 latency, the cost of the same tokens at a frontier " +
      "model's list price (frontier_reference_cost_usd), savings_usd and savings_pct, per surface and in total, plus " +
      "the trial balance. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "trial_status",
    title: "Trial balance",
    description:
      "Show the trial balance of this TurbineH account: USD spent, the trial cap, USD remaining and whether the " +
      "limit is reached. Free; call it before long jobs or when a call was refused.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

type Id = string | number | null;
interface RpcMessage {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

const rpc = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const rpcError = (id: Id, code: number, message: string, status = 200) =>
  rpc({ jsonrpc: "2.0", id, error: { code, message } }, status);

/** A tool result with text content; `isError` results are shown to the model as failures it can act on. */
const toolResult = (text: string, structured?: Record<string, unknown>, isError = false) => ({
  content: [{ type: "text", text }],
  ...(structured ? { structuredContent: structured } : {}),
  isError,
});

/** A refused or failed call as a tool error: the problem's message and code (402 → trial_limit_reached). */
async function toolErrorOf(
  res: Response,
  metrics?: RequestMetrics,
): Promise<ReturnType<typeof toolResult>> {
  let p: { title?: string; detail?: string; code?: string } = {};
  try {
    p = (await res.json()) as typeof p;
  } catch {
    // Not JSON: status only.
  }
  const message = p.detail ?? p.title ?? `Request failed (${res.status})`;
  return toolResult(
    message,
    {
      error: {
        status: res.status,
        ...(p.code ? { code: p.code } : {}),
        message,
        ...(res.status === 402 ? { contact: TRIAL_CONTACT } : {}),
      },
      ...(metrics && metrics.model_calls > 0 ? { metrics } : {}),
    },
    true,
  );
}

const OrchestrateArgs = OrchestrateBody.pick({
  task: true,
  input: true,
  schema: true,
  instructions: true,
}).strict();
const ChatArgs = z.object({ messages: OrchestratedChatBody.shape.messages }).strict();

async function callTool(
  app: AiApp,
  name: unknown,
  args: unknown,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
  startedAt: number,
): Promise<ReturnType<typeof toolResult> | null> {
  switch (name) {
    case "trial_status": {
      const b = await trialBalance(app, deps);
      const status = b
        ? { ...b, contact: TRIAL_CONTACT }
        : {
            spentUsd: await deps.trialSpent(app.ownerId),
            capUsd: null,
            remainingUsd: null,
            reached: false,
          };
      const text = b
        ? b.reached
          ? `Trial limit reached: $${b.spentUsd.toFixed(4)} of $${b.capUsd} used. Contact ${TRIAL_CONTACT} to continue.`
          : `$${b.remainingUsd.toFixed(4)} of $${b.capUsd} trial remaining ($${b.spentUsd.toFixed(4)} spent).`
        : "This account has no trial cap.";
      return toolResult(text, status);
    }
    case "usage_report": {
      const r = await usageReport(app, deps);
      if (!r) return toolResult("The usage report is not available right now.", undefined, true);
      const text =
        `${r.requests} requests, ${r.input_tokens + r.output_tokens} tokens, $${r.cost_usd.toFixed(6)} ` +
        `(same tokens at the ${r.frontier_reference}: $${r.frontier_reference_cost_usd.toFixed(6)}; ` +
        `savings ${r.savings_pct}%). Latency p50 ${r.latency_ms.p50 ?? "-"} ms, p95 ${r.latency_ms.p95 ?? "-"} ms.` +
        (r.trial.remaining_usd === null
          ? ""
          : ` Trial remaining: $${r.trial.remaining_usd.toFixed(4)} of $${r.trial.cap_usd}.`);
      return toolResult(text, r as unknown as Record<string, unknown>);
    }
    case "orchestrate": {
      const a = OrchestrateArgs.safeParse(args ?? {});
      if (!a.success)
        return toolResult(`Invalid arguments: ${z.prettifyError(a.error)}`, undefined, true);
      const out = await orchestrateFor(
        app,
        "orchestrate",
        { ...a.data, timeoutMs: DEFAULT_TIMEOUT_MS },
        deps,
        engine,
        { surface: "mcp:orchestrate", startedAt },
      );
      if (!out.ok) return toolErrorOf(out.response, out.metrics);
      let answer: unknown = out.result.text;
      if (a.data.schema) {
        try {
          answer = JSON.parse(out.result.text) as unknown;
        } catch {
          // Keep the text.
        }
      }
      return toolResult(out.result.text, {
        answer,
        route: out.result.route,
        usage: out.result.usage,
        metrics: out.metrics,
        ...(await remaining(app, deps)),
      });
    }
    case "chat": {
      const a = ChatArgs.safeParse(args ?? {});
      if (!a.success)
        return toolResult(`Invalid arguments: ${z.prettifyError(a.error)}`, undefined, true);
      const request = chatToOrchestrate({ messages: a.data.messages });
      if (!request) return toolResult("The last message must be the user's.", undefined, true);
      const out = await orchestrateFor(app, "orchestrate", request, deps, engine, {
        surface: "mcp:chat",
        startedAt,
      });
      if (!out.ok) return toolErrorOf(out.response, out.metrics);
      return toolResult(out.result.text, {
        reply: out.result.text,
        route: out.result.route,
        usage: out.result.usage,
        metrics: out.metrics,
        ...(await remaining(app, deps)),
      });
    }
    default:
      return null;
  }
}

async function remaining(app: AiApp, deps: GatewayDeps): Promise<{ trialRemainingUsd?: number }> {
  const h = await trialHeaders(app, deps);
  const v = Object.values(h)[0];
  return v === undefined ? {} : { trialRemainingUsd: Number(v) };
}

/** One HTTP request to the MCP endpoint (POST = one JSON-RPC message; GET/DELETE are not offered: 405). */
export async function handleMcp(
  req: Request,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Response> {
  const startedAt = Date.now();
  if (req.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  const app = await authenticate(req, deps);
  if (!app)
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or missing AI token" } },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": 'Bearer realm="turbineh-orchestration"',
        },
      },
    );
  const raw = await req.text();
  if (raw.length > deps.config.AI_GATEWAY_MAX_BODY_BYTES)
    return rpcError(null, -32600, "Request too large", 413);
  let m: RpcMessage;
  try {
    m = JSON.parse(raw) as RpcMessage;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0")
    return rpcError(null, -32600, "Invalid Request", 400);
  const isRequest = m.id !== undefined && m.id !== null;
  // Notifications and responses from the client: accepted, nothing to answer.
  if (!isRequest || typeof m.method !== "string") return new Response(null, { status: 202 });
  const id = m.id as Id;
  const reply = (result: unknown) => rpc({ jsonrpc: "2.0", id, result });

  switch (m.method) {
    case "initialize": {
      const asked = (m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return reply({
        protocolVersion:
          typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const p = (m.params ?? {}) as { name?: unknown; arguments?: unknown };
      try {
        const result = await callTool(app, p.name, p.arguments, deps, engine, startedAt);
        if (!result) return rpcError(id, -32602, `Unknown tool: ${String(p.name)}`);
        return reply(result);
      } catch (err) {
        console.error("[ai-mcp] tool failed", err instanceof Error ? err.name : "unknown");
        return reply(toolResult("Internal error, try again later.", undefined, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m.method}`);
  }
}

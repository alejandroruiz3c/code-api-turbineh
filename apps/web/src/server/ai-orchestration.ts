import { randomUUID } from "node:crypto";
import type { AiApp } from "@turbineh/db";
import {
  type AgentStepRequest,
  type AgentStepResult,
  type ChatAnswer,
  type EngineIO,
  isEngineError,
  type OrchestrateRequest,
  type OrchestrateResult,
  type OrchestrationEngine,
} from "@turbineh/orchestration";
import { z } from "zod";
import {
  admission,
  authenticate,
  chatBody,
  forward,
  type GatewayConfig,
  type GatewayDeps,
  handleGateway,
  Message,
  problem,
  ToolName,
  trialGate,
  trialHeaders,
  upstreamOf,
  upstreamProblem,
} from "./ai-gateway";

/**
 * Orchestration endpoints of the AI gateway (ADR-0053): generated apps ship a thin client and the orchestration runs
 * here. POST /v1/ai/v1/agent runs one step of an agent turn (the app executes the tools it gets back and posts the
 * results); POST /v1/ai/v1/orchestrate runs one orchestrated request. Same token, trial cap, rate limit and quota as
 * the other gateway endpoints; every model and decision call inside is billed to the app and its account.
 */
const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const Doc = z.object({ title: z.string().max(200), text: z.string().max(50_000) });
const ToolDef = z.object({
  name: ToolName,
  description: z.string().max(2000),
  parameters: z.record(z.string(), z.unknown()),
  irreversible: z.boolean(),
});
/** Budget of the request, ms; optional for developers (default DEFAULT_TIMEOUT_MS, capped by the gateway). */
const Timeout = z.number().int().min(1000).max(290_000).optional();
export const DEFAULT_TIMEOUT_MS = 60_000;

export const AgentStepBody = z.object({
  phase: z.enum(["start", "continue", "confirmed"]),
  instructions: z.string().max(12_000),
  tools: z.array(ToolDef).max(32),
  messages: z.array(Message).min(1).max(99),
  context: z.array(Doc).max(20).optional(),
  now: z.iso.datetime({ offset: true }),
  route: z.string().max(32).optional(),
  confirmed: z
    .object({ summary: z.string().max(2000), result: z.unknown(), failed: z.boolean() })
    .optional(),
  timeoutMs: Timeout,
});

export const OrchestrateBody = z.object({
  task: z.string().min(1).max(4000),
  input: z.string().min(1).max(200_000),
  instructions: z.string().max(8000).optional(),
  context: z.array(Doc).max(20).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(20)
    .optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  tools: z
    .array(
      z.object({ name: ToolName, description: z.string().max(2000), irreversible: z.boolean() }),
    )
    .max(32)
    .optional(),
  timeoutMs: Timeout,
});

/** Allowed routes: AI_GATEWAY_ROUTES pairs whose model is an allowed chat model. */
export function gatewayRoutes(cfg: GatewayConfig): { name: string; model: string }[] {
  const allowed = new Set(list(cfg.AI_GATEWAY_CHAT_MODELS));
  return list(cfg.AI_GATEWAY_ROUTES)
    .map((pair) => pair.split("=").map((x) => x.trim()))
    .filter(
      (p): p is [string, string] => p.length === 2 && Boolean(p[0]) && allowed.has(p[1] ?? ""),
    )
    .map(([name, model]) => ({ name, model }));
}

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { code: "upstream" as const, status });

const ChatJson = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                function: z.object({ name: z.string().min(1).max(64), arguments: z.string() }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .partial()
    .optional(),
});

const DecisionJson = z.object({
  answers: z.record(z.string(), z.unknown()),
  model: z.string(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/** The engine's I/O for one app: every call goes through the gateway's validation, hedging and billing. */
export function engineIO(app: AiApp, deps: GatewayDeps): EngineIO {
  const cfg = deps.config;
  const deciderModel = list(cfg.AI_GATEWAY_DECIDER_MODELS)[0];
  return {
    routes: gatewayRoutes(cfg),
    structurerModel: list(cfg.AI_GATEWAY_CHAT_MODELS).includes(cfg.AI_GATEWAY_STRUCTURER_MODEL)
      ? cfg.AI_GATEWAY_STRUCTURER_MODEL
      : (list(cfg.AI_GATEWAY_CHAT_MODELS)[0] ?? ""),
    chat: async (call, timeoutMs): Promise<ChatAnswer> => {
      let body: Record<string, unknown>;
      try {
        body = chatBody(call, cfg);
      } catch {
        throw Object.assign(new Error("invalid model call"), { code: "invalid" as const });
      }
      const r = await forward(app, "chat", body, deps, timeoutMs);
      if (!r.ok) throw fail(r.status, "model call failed");
      const data = ChatJson.safeParse(r.json);
      if (!data.success) throw fail(502, "unexpected model response");
      const message = data.data.choices[0]?.message;
      return {
        text: message?.content ?? "",
        toolCalls: (message?.tool_calls ?? []).map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
        inputTokens: Math.round(data.data.usage?.prompt_tokens ?? 0),
        outputTokens: Math.round(data.data.usage?.completion_tokens ?? 0),
      };
    },
    ...(upstreamOf("decider", cfg).key && deciderModel
      ? {
          decide: async (state, questions, timeoutMs) => {
            const r = await forward(
              app,
              "decider",
              { model: deciderModel, state, questions },
              deps,
              timeoutMs,
            );
            if (!r.ok) throw fail(r.status, "decision failed");
            const data = DecisionJson.safeParse(r.json);
            if (!data.success) throw fail(502, "unexpected decision response");
            return data.data;
          },
        }
      : {}),
    validate: (schema, value) => {
      try {
        return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(value)
          .success;
      } catch {
        return true;
      }
    },
  };
}

export type Orchestrated<T> = { ok: true; result: T } | { ok: false; response: Response };

/**
 * Runs one validated orchestration request for an authenticated app: trial cap → admit → engine. Shared by the HTTP
 * endpoints, the OpenAI-compatible orchestrated chat and the MCP server (ADR-0059). Failures come back as problem
 * responses (402 trial limit, 429, 422 refusal, 5xx).
 */
export async function orchestrateFor(
  app: AiApp,
  op: "orchestrate",
  body: OrchestrateRequest,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Orchestrated<OrchestrateResult>>;
export async function orchestrateFor(
  app: AiApp,
  op: "agent",
  body: AgentStepRequest,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Orchestrated<AgentStepResult>>;
export async function orchestrateFor(
  app: AiApp,
  op: "agent" | "orchestrate",
  body: AgentStepRequest | OrchestrateRequest,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Orchestrated<AgentStepResult | OrchestrateResult>> {
  const cfg = deps.config;
  const refused = (await trialGate(app, deps)) ?? (await admission(app, deps));
  if (refused) return { ok: false, response: refused };
  if (!upstreamOf("chat", cfg).key || gatewayRoutes(cfg).length === 0)
    return { ok: false, response: problem(503, "AI is not available right now") };

  const io = engineIO(app, deps);
  const timeoutMs = Math.min(body.timeoutMs || DEFAULT_TIMEOUT_MS, cfg.AI_GATEWAY_TIMEOUT_MS);
  try {
    const result =
      op === "agent"
        ? await engine.agentStep({ ...(body as AgentStepRequest), timeoutMs }, io)
        : await engine.orchestrate({ ...(body as OrchestrateRequest), timeoutMs }, io);
    return { ok: true, result };
  } catch (err) {
    if (isEngineError(err)) {
      if (err.code === "unsafe")
        return {
          ok: false,
          response: problem(422, "This request can't be processed. Please rephrase it.", {
            code: "unsafe_request",
          }),
        };
      if (err.code === "invalid") return { ok: false, response: problem(400, "Invalid request") };
      return { ok: false, response: upstreamProblem(err.status ?? 502) };
    }
    console.error("[ai-gateway] orchestration failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, response: problem(502, "AI provider error") };
  }
}

/** Reads and size-checks a JSON body; a problem response when it is too large or not JSON. */
async function readJson(
  req: Request,
  cfg: GatewayConfig,
): Promise<{ ok: true; json: unknown } | { ok: false; response: Response }> {
  const raw = await req.text();
  if (raw.length > cfg.AI_GATEWAY_MAX_BODY_BYTES)
    return { ok: false, response: problem(413, "Request too large") };
  try {
    return { ok: true, json: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: problem(400, "Invalid request") };
  }
}

/** One orchestration request: authenticate → validate → trial cap → admit → engine → answer. */
export async function handleOrchestration(
  req: Request,
  op: "agent" | "orchestrate",
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Response> {
  const app = await authenticate(req, deps);
  if (!app) return problem(401, "Invalid or missing AI token");
  const read = await readJson(req, deps.config);
  if (!read.ok) return read.response;
  const parsed = (op === "agent" ? AgentStepBody : OrchestrateBody).safeParse(read.json);
  if (!parsed.success) return problem(400, "Invalid request");
  const out =
    op === "agent"
      ? await orchestrateFor(app, "agent", parsed.data as AgentStepRequest, deps, engine)
      : await orchestrateFor(app, "orchestrate", parsed.data as OrchestrateRequest, deps, engine);
  if (!out.ok) return out.response;
  return Response.json(out.result, {
    headers: { "Cache-Control": "no-store", ...(await trialHeaders(app, deps)) },
  });
}

/**
 * Model names that ask the OpenAI-compatible chat endpoint for TurbineH's orchestrated routing (ADR-0059) instead of
 * one fixed model: the orchestration picks the route for each request.
 */
export const ORCHESTRATED_MODELS: ReadonlySet<string> = new Set(["turbineh-orchestration", "auto"]);
export const ORCHESTRATED_MODEL = "turbineh-orchestration";

const ChatTurn = z.object({
  role: z.enum(["system", "developer", "user", "assistant"]),
  content: z.union([
    z.string().max(200_000),
    z.array(z.object({ type: z.literal("text"), text: z.string().max(200_000) })).max(50),
  ]),
});
export const OrchestratedChatBody = z.object({
  model: z.string().max(100).optional(),
  messages: z.array(ChatTurn).min(1).max(100),
  response_format: z.object({ type: z.enum(["json_object", "text"]) }).optional(),
  stream: z.literal(false).optional(),
  timeoutMs: Timeout,
});
export type OrchestratedChat = z.infer<typeof OrchestratedChatBody>;

const textOf = (c: OrchestratedChat["messages"][number]["content"]) =>
  typeof c === "string" ? c : c.map((p) => p.text).join("\n");

/**
 * An OpenAI-style conversation as one orchestrated request: system/developer messages become the instructions, the
 * last user message the input, the earlier turns the history (newest 20). Null when the last message is not the user's.
 */
export function chatToOrchestrate(
  chat: OrchestratedChat,
  extraInstructions?: string,
): OrchestrateRequest | null {
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== "user") return null;
  const input = textOf(last.content).trim();
  if (!input) return null;
  const instructions = [
    extraInstructions,
    ...chat.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => textOf(m.content)),
  ]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n\n")
    .slice(0, 8000);
  const history = chat.messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: textOf(m.content).slice(0, 20_000),
    }))
    .slice(-20);
  return {
    task:
      chat.response_format?.type === "json_object"
        ? "Reply to the user's last message with a JSON object."
        : "Reply to the user's last message.",
    input: input.slice(0, 200_000),
    ...(instructions ? { instructions } : {}),
    ...(history.length ? { history } : {}),
    timeoutMs: chat.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** An orchestrated answer in the OpenAI chat.completion shape (the model is always the orchestration). */
export function chatCompletionOf(result: OrchestrateResult): Record<string, unknown> {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: ORCHESTRATED_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
    turbineh: { route: result.route, calls: result.usage.calls },
  };
}

/**
 * POST /v1/ai/v1/chat/completions (ADR-0029, ADR-0059): `model: "turbineh-orchestration"` (or "auto", or no model)
 * is answered by the orchestration (routing per request); an allowed model id is forwarded to that model as before.
 */
export async function handleChatCompletions(
  req: Request,
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Response> {
  const app = await authenticate(req, deps);
  if (!app) return problem(401, "Invalid or missing AI token");
  const raw = await req.text();
  let model: unknown;
  try {
    model = (JSON.parse(raw) as { model?: unknown } | null)?.model;
  } catch {
    // handleGateway answers 400 (or 413) for an unreadable body.
  }
  if (model !== undefined && !(typeof model === "string" && ORCHESTRATED_MODELS.has(model)))
    return handleGateway(
      new Request(req.url, { method: "POST", headers: req.headers, body: raw }),
      "chat",
      deps,
    );
  if (raw.length > deps.config.AI_GATEWAY_MAX_BODY_BYTES) return problem(413, "Request too large");
  let parsed: ReturnType<typeof OrchestratedChatBody.safeParse>;
  try {
    const json = JSON.parse(raw) as Record<string, unknown> | null;
    if (json && (json.tools !== undefined || json.tool_choice !== undefined))
      return problem(
        400,
        "Tools are not supported by turbineh-orchestration chat; use POST /v1/ai/v1/agent",
      );
    parsed = OrchestratedChatBody.safeParse(json);
  } catch {
    return problem(400, "Invalid request");
  }
  if (!parsed.success) return problem(400, "Invalid request");
  const request = chatToOrchestrate(parsed.data);
  if (!request) return problem(400, "The last message must be the user's");
  const out = await orchestrateFor(app, "orchestrate", request, deps, engine);
  if (!out.ok) return out.response;
  return Response.json(chatCompletionOf(out.result), {
    headers: { "Cache-Control": "no-store", ...(await trialHeaders(app, deps)) },
  });
}

import type { AiApp } from "@turbineh/db";
import {
  type AgentStepRequest,
  type ChatAnswer,
  type EngineIO,
  isEngineError,
  type OrchestrateRequest,
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
  Message,
  problem,
  ToolName,
  trialGate,
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
const Timeout = z.number().int().min(1000).max(290_000);

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

/** One orchestration request: authenticate → validate → trial cap → admit → engine → answer. */
export async function handleOrchestration(
  req: Request,
  op: "agent" | "orchestrate",
  deps: GatewayDeps,
  engine: OrchestrationEngine,
): Promise<Response> {
  const app = await authenticate(req, deps);
  if (!app) return problem(401, "Invalid or missing AI token");
  const cfg = deps.config;
  const raw = await req.text();
  if (raw.length > cfg.AI_GATEWAY_MAX_BODY_BYTES) return problem(413, "Request too large");
  let body: AgentStepRequest | OrchestrateRequest;
  try {
    const parsed = JSON.parse(raw) as unknown;
    body = (op === "agent" ? AgentStepBody : OrchestrateBody).parse(parsed) as
      AgentStepRequest | OrchestrateRequest;
  } catch {
    return problem(400, "Invalid request");
  }
  const refused = (await trialGate(app, deps)) ?? (await admission(app, deps));
  if (refused) return refused;
  if (!upstreamOf("chat", cfg).key) return problem(503, "AI is not available right now");
  if (gatewayRoutes(cfg).length === 0) return problem(503, "AI is not available right now");

  const io = engineIO(app, deps);
  const timeoutMs = Math.min(body.timeoutMs, cfg.AI_GATEWAY_TIMEOUT_MS);
  try {
    const result =
      op === "agent"
        ? await engine.agentStep({ ...(body as AgentStepRequest), timeoutMs }, io)
        : await engine.orchestrate({ ...(body as OrchestrateRequest), timeoutMs }, io);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isEngineError(err)) {
      if (err.code === "unsafe")
        return problem(422, "This request can't be processed. Please rephrase it.", {
          code: "unsafe_request",
        });
      if (err.code === "invalid") return problem(400, "Invalid request");
      return upstreamProblem(err.status ?? 502);
    }
    console.error("[ai-gateway] orchestration failed", err instanceof Error ? err.name : "unknown");
    return problem(502, "AI provider error");
  }
}

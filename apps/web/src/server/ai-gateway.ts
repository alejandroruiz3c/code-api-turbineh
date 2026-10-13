import type { AdmitResult, AiApp } from "@turbineh/db";
import { z } from "zod";

/**
 * TurbineH AI gateway (ADR-0029). Generated AI apps call it with their app token; it forwards to TurbineH's model
 * provider and JEV with TurbineH's keys, which never leave this server. It enforces a model allow-list, request
 * limits, a per-app rate limit and daily token quota, and records usage per app for billing. Prompts, outputs and
 * keys are never logged, and provider errors are never echoed.
 *
 * Chat completions are hedged (ADR-0043): when the provider has not answered after the model's hedge delay (about its
 * p90), or failed fast, one duplicate request goes to the same model (or to the next allowed one); the first valid
 * answer wins and the other request is cancelled. At most one hedge per request, within a per-app daily budget; the
 * app is billed only for the answer it receives, and hedges are recorded in the usage metrics (cost stays internal).
 */

export type GatewayKind = "chat" | "embeddings" | "decider";

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const empty = (v: unknown) => (v === "" ? undefined : v);
const ConfigSchema = z.object({
  /** OpenAI-compatible provider of open models (the one the worker uses) and its key. */
  AI_GATEWAY_UPSTREAM_URL: z.preprocess(empty, z.url().default("https://api.scaleway.ai/v1")),
  AI_GATEWAY_UPSTREAM_KEY: z.preprocess(empty, z.string().min(1).optional()),
  /** JEV by TypeSafe (SystemOne API) and its key. */
  AI_GATEWAY_TYPESAFE_URL: z.preprocess(empty, z.url().default("https://api.typesafe.ai")),
  AI_GATEWAY_TYPESAFE_KEY: z.preprocess(empty, z.string().min(1).optional()),
  /** Documented open models only (knowledge/modelos-ia). */
  AI_GATEWAY_CHAT_MODELS: z.preprocess(
    empty,
    z.string().default("gemma-4-26b-a4b-it,deepseek-v4-flash-0731,glm-5.2"),
  ),
  AI_GATEWAY_EMBEDDING_MODELS: z.preprocess(empty, z.string().default("qwen3-embedding-8b")),
  AI_GATEWAY_DECIDER_MODELS: z.preprocess(empty, z.string().default("jev-1.13.0")),
  AI_GATEWAY_MAX_BODY_BYTES: z.preprocess(empty, z.coerce.number().int().default(1_000_000)),
  AI_GATEWAY_MAX_OUTPUT_TOKENS: z.preprocess(empty, z.coerce.number().int().default(4096)),
  AI_GATEWAY_TIMEOUT_MS: z.preprocess(empty, z.coerce.number().int().default(90_000)),
  /** Chat hedging (ADR-0043): delay before the duplicate request, ms (about the model's p90); 0 disables hedging. */
  AI_GATEWAY_HEDGE_AFTER_MS: z.preprocess(empty, z.coerce.number().int().min(0).default(3800)),
  /** Per-model delays overriding the default: "model=ms,model=ms". */
  AI_GATEWAY_HEDGE_AFTER_MS_BY_MODEL: z.preprocess(empty, z.string().default("")),
  /** Where the hedge goes: the same model, or the next model of AI_GATEWAY_CHAT_MODELS. */
  AI_GATEWAY_HEDGE_TARGET: z.preprocess(empty, z.enum(["same", "next"]).default("same")),
  /** Per-app daily hedge budget: at most max(MIN, RATIO × the app's chat calls of the day) per model. */
  AI_GATEWAY_HEDGE_BUDGET_RATIO: z.preprocess(empty, z.coerce.number().min(0).max(1).default(0.1)),
  AI_GATEWAY_HEDGE_BUDGET_MIN: z.preprocess(empty, z.coerce.number().int().min(0).default(20)),
});
export type GatewayConfig = z.infer<typeof ConfigSchema>;
export const gatewayConfig = (env: Record<string, string | undefined> = process.env) =>
  ConfigSchema.parse(env);

/** Defaults for new app tokens (per app). */
export const appTokenDefaults = (env: Record<string, string | undefined> = process.env) => ({
  dailyTokenQuota: Number(env.AI_GATEWAY_DAILY_TOKENS ?? 2_000_000),
  requestsPerMinute: Number(env.AI_GATEWAY_RPM ?? 60),
});

const ToolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ToolCall = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("function"),
  function: z.object({ name: ToolName, arguments: z.string().max(20_000) }),
});
/** Chat messages, including the tool-calling turns of runAgent (ADR-0033); unknown fields are dropped. */
const Message = z.discriminatedUnion("role", [
  z.object({ role: z.enum(["system", "user"]), content: z.string().max(200_000) }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(200_000).nullable(),
    tool_calls: z.array(ToolCall).min(1).max(8).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: z.string().min(1).max(100),
    content: z.string().max(200_000),
  }),
]);
const Tool = z.object({
  type: z.literal("function"),
  function: z.object({
    name: ToolName,
    description: z.string().max(2000).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});
const ToolChoice = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({ type: z.literal("function"), function: z.object({ name: ToolName }) }),
]);

/** Only the fields the orchestrator uses are forwarded; anything else is dropped. */
export function chatBody(body: unknown, cfg: GatewayConfig): Record<string, unknown> {
  const b = z
    .object({
      model: z.string(),
      messages: z.array(Message).min(1).max(100),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().positive().optional(),
      response_format: z.object({ type: z.enum(["json_object", "text"]) }).optional(),
      tools: z.array(Tool).max(32).optional(),
      tool_choice: ToolChoice.optional(),
      stream: z.literal(false).optional(),
    })
    .parse(body);
  if (!list(cfg.AI_GATEWAY_CHAT_MODELS).includes(b.model))
    throw new GatewayError(400, "Model not allowed");
  const tools = b.tools && b.tools.length > 0 ? b.tools : null;
  return {
    model: b.model,
    messages: b.messages,
    temperature: b.temperature ?? 0.2,
    max_tokens: Math.min(b.max_tokens ?? 1200, cfg.AI_GATEWAY_MAX_OUTPUT_TOKENS),
    ...(b.response_format ? { response_format: b.response_format } : {}),
    ...(tools ? { tools, tool_choice: b.tool_choice ?? "auto" } : {}),
  };
}

export function embeddingsBody(body: unknown, cfg: GatewayConfig): Record<string, unknown> {
  const b = z
    .object({
      model: z.string(),
      input: z.union([z.string().max(32_000), z.array(z.string().max(32_000)).min(1).max(256)]),
      dimensions: z.number().int().min(1).max(4096).optional(),
      encoding_format: z.literal("float").optional(),
    })
    .parse(body);
  if (!list(cfg.AI_GATEWAY_EMBEDDING_MODELS).includes(b.model))
    throw new GatewayError(400, "Model not allowed");
  return {
    model: b.model,
    input: b.input,
    encoding_format: "float",
    ...(b.dimensions ? { dimensions: b.dimensions } : {}),
  };
}

export function deciderBody(body: unknown, cfg: GatewayConfig): Record<string, unknown> {
  const allowed = list(cfg.AI_GATEWAY_DECIDER_MODELS);
  const b = z
    .object({
      model: z.string().optional(),
      state: z.record(z.string(), z.unknown()),
      questions: z.record(z.string(), z.unknown()),
    })
    .parse(body);
  const model = b.model ?? allowed[0] ?? "";
  if (!allowed.includes(model)) throw new GatewayError(400, "Model not allowed");
  return { model, state: b.state, questions: b.questions };
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Tokens reported by the provider for each endpoint. */
export function usageOf(
  kind: GatewayKind,
  json: unknown,
): { inputTokens: number; outputTokens: number } {
  const u = (json as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  if (kind === "decider")
    return { inputTokens: n("input_tokens"), outputTokens: n("output_tokens") };
  return {
    inputTokens: n("prompt_tokens"),
    outputTokens: kind === "chat" ? n("completion_tokens") : 0,
  };
}

/** Which request answered when a hedge was fired. */
export type HedgeOutcome = "primary-won" | "hedge-won";

export interface GatewayDeps {
  verifyToken: (token: string) => Promise<AiApp | null>;
  admit: (app: AiApp) => Promise<AdmitResult>;
  record: (u: {
    appId: string;
    endpoint: GatewayKind;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Set only when a hedge was fired for this request. */
    hedge?: HedgeOutcome;
  }) => Promise<void>;
  /** Takes one hedge from the app's daily budget (atomic); false when the budget is spent. */
  reserveHedge: (app: AiApp, model: string) => Promise<boolean>;
  fetch: typeof fetch;
  config: GatewayConfig;
}

const problem = (status: number, title: string) =>
  Response.json(
    { title, status },
    {
      status,
      headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
    },
  );

/** One gateway request: authenticate → validate → admit → forward with TurbineH keys → record usage. */
export async function handleGateway(
  req: Request,
  kind: GatewayKind,
  deps: GatewayDeps,
): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const app = auth.startsWith("Bearer ") ? await deps.verifyToken(auth.slice(7).trim()) : null;
  if (!app) return problem(401, "Invalid or missing AI token");

  const cfg = deps.config;
  const raw = await req.text();
  if (raw.length > cfg.AI_GATEWAY_MAX_BODY_BYTES) return problem(413, "Request too large");
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    body =
      kind === "chat"
        ? chatBody(parsed, cfg)
        : kind === "embeddings"
          ? embeddingsBody(parsed, cfg)
          : deciderBody(parsed, cfg);
  } catch (err) {
    return err instanceof GatewayError
      ? problem(err.status, err.message)
      : problem(400, "Invalid request");
  }

  const admitted = await deps.admit(app);
  if (!admitted.ok)
    return problem(
      429,
      admitted.reason === "rate" ? "Too many AI requests" : "Daily AI quota reached",
    );

  const upstream =
    kind === "decider"
      ? {
          url: `${cfg.AI_GATEWAY_TYPESAFE_URL.replace(/\/$/, "")}/v1/systemone`,
          key: cfg.AI_GATEWAY_TYPESAFE_KEY,
        }
      : {
          url: `${cfg.AI_GATEWAY_UPSTREAM_URL.replace(/\/$/, "")}/${kind === "chat" ? "chat/completions" : "embeddings"}`,
          key: cfg.AI_GATEWAY_UPSTREAM_KEY,
        };
  if (!upstream.key) return problem(503, "AI is not available right now");

  const sent = Date.now();
  const result =
    kind === "chat"
      ? await forwardHedged(app, body, upstream as { url: string; key: string }, deps)
      : await forwardOnce(deps.fetch, upstream as { url: string; key: string }, body, [
          AbortSignal.timeout(cfg.AI_GATEWAY_TIMEOUT_MS),
        ]);
  if (!result.ok) {
    // Provider bodies may contain request details or account data: never echoed.
    return result.status === 0
      ? problem(504, "AI provider did not respond")
      : problem(
          result.status === 429 ? 429 : 502,
          result.status === 429 ? "AI provider busy, retry later" : "AI provider error",
        );
  }
  // Billed: only the tokens of the answer the app receives, on the model that wrote it.
  const usage = usageOf(kind, result.json);
  await deps
    .record({
      appId: app.id,
      endpoint: kind,
      model: result.model,
      ...usage,
      ...(result.hedge === "primary-won" || result.hedge === "hedge-won"
        ? { hedge: result.hedge }
        : {}),
    })
    .catch(() => undefined);
  return Response.json(result.json, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `upstream;dur=${Date.now() - sent}`,
      ...(kind === "chat" ? { "X-TurbineH-Hedge": result.hedge } : {}),
    },
  });
}

type Attempt =
  { ok: true; json: unknown; model: string } | { ok: false; status: number; model: string };
type Forwarded = Attempt & { hedge: HedgeOutcome | "none" | "budget" };

/** A chat answer the app can use (an upstream 200 with an unreadable body is a failure). */
const validChat = (json: unknown) =>
  Array.isArray((json as { choices?: unknown } | null)?.choices) &&
  ((json as { choices: unknown[] }).choices.length ?? 0) > 0;

/** One upstream request, aborted by any of `signals` (the request deadline, or the other request of a hedge won). */
async function forwardOnce(
  fetchFn: typeof fetch,
  upstream: { url: string; key: string },
  body: Record<string, unknown>,
  signals: AbortSignal[],
  validate: (json: unknown) => boolean = () => true,
): Promise<Forwarded> {
  const model = String(body.model);
  let res: Response;
  try {
    res = await fetchFn(upstream.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstream.key}` },
      body: JSON.stringify(body),
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
  } catch {
    // Network failure, timeout or cancellation.
    return { ok: false, status: 0, model, hedge: "none" };
  }
  if (!res.ok) return { ok: false, status: res.status, model, hedge: "none" };
  try {
    const json = (await res.json()) as unknown;
    if (validate(json)) return { ok: true, json, model, hedge: "none" };
  } catch {
    // Unreadable body (or cancelled while reading it).
  }
  return { ok: false, status: signals.some((x) => x.aborted) ? 0 : 502, model, hedge: "none" };
}

/** Hedge delay of a model (ms; 0 = no hedging). */
export function hedgeDelay(cfg: GatewayConfig, model: string): number {
  for (const pair of list(cfg.AI_GATEWAY_HEDGE_AFTER_MS_BY_MODEL)) {
    const [m, ms] = pair.split("=");
    if (m?.trim() === model && ms !== undefined && /^\d+$/.test(ms.trim())) return Number(ms);
  }
  return cfg.AI_GATEWAY_HEDGE_AFTER_MS;
}

/** The model a hedge goes to: the same one, or the next allowed chat model when configured. */
export function hedgeModel(cfg: GatewayConfig, model: string): string {
  if (cfg.AI_GATEWAY_HEDGE_TARGET === "same") return model;
  const models = list(cfg.AI_GATEWAY_CHAT_MODELS);
  return models[models.indexOf(model) + 1] ?? model;
}

/**
 * Chat request with at most one hedge. The hedge fires when no answer arrived within the model's hedge delay, or
 * when the first request failed with a network error or a server error before that; it needs a unit of the app's
 * hedge budget. The first valid answer wins and the other request is aborted. Both requests carry the same validated
 * body (same tools, same output cap); a hedge to the next model only changes `model`.
 */
async function forwardHedged(
  app: AiApp,
  body: Record<string, unknown>,
  upstream: { url: string; key: string },
  deps: GatewayDeps,
): Promise<Forwarded> {
  const cfg = deps.config;
  const model = String(body.model);
  const delay = hedgeDelay(cfg, model);
  // One deadline for the whole request: a hedge never extends it.
  const deadline = AbortSignal.timeout(cfg.AI_GATEWAY_TIMEOUT_MS);
  const primaryCancel = new AbortController();
  const hedgeCancel = new AbortController();
  const primary = forwardOnce(
    deps.fetch,
    upstream,
    body,
    [deadline, primaryCancel.signal],
    validChat,
  );
  if (delay <= 0) return primary;

  return new Promise<Forwarded>((resolve) => {
    let settled = false;
    let hedge: "none" | "pending" | "budget" | "fired" = "none";
    let inFlight = 1;
    let lastFailure: Forwarded | null = null;
    const outcome = (winner: "primary" | "hedge"): Forwarded["hedge"] =>
      hedge === "fired"
        ? winner === "primary"
          ? "primary-won"
          : "hedge-won"
        : hedge === "budget"
          ? "budget"
          : "none";
    const settle = (r: Forwarded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const finishIfIdle = () => {
      if (inFlight === 0 && hedge !== "pending" && lastFailure)
        settle({ ...lastFailure, hedge: outcome("primary") });
    };
    const onResult = (r: Forwarded, who: "primary" | "hedge") => {
      inFlight--;
      if (settled) return;
      if (r.ok) {
        (who === "primary" ? hedgeCancel : primaryCancel).abort();
        settle({ ...r, hedge: outcome(who) });
        return;
      }
      lastFailure = r;
      // A fast failure of the first request (network or server error) is hedged at once instead of waiting.
      if (
        who === "primary" &&
        hedge === "none" &&
        !deadline.aborted &&
        (r.status === 0 || r.status >= 500)
      ) {
        clearTimeout(timer);
        void fire();
        return;
      }
      finishIfIdle();
    };
    const fire = async () => {
      if (settled || hedge !== "none" || deadline.aborted) return;
      hedge = "pending";
      const granted = await deps.reserveHedge(app, model).catch(() => false);
      if (settled) return;
      if (!granted || deadline.aborted) {
        hedge = "budget";
        finishIfIdle();
        return;
      }
      hedge = "fired";
      inFlight++;
      void forwardOnce(
        deps.fetch,
        upstream,
        { ...body, model: hedgeModel(cfg, model) },
        [deadline, hedgeCancel.signal],
        validChat,
      ).then((r) => onResult(r, "hedge"));
    };
    const timer = setTimeout(() => void fire(), delay);
    void primary.then((r) => onResult(r, "primary"));
  });
}

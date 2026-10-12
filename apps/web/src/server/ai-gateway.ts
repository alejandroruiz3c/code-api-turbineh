import type { AdmitResult, AiApp } from "@turbineh/db";
import { z } from "zod";

/**
 * TurbineH AI gateway (ADR-0029). Generated AI apps call it with their app token; it forwards to TurbineH's model
 * provider and JEV with TurbineH's keys, which never leave this server. It enforces a model allow-list, request
 * limits, a per-app rate limit and daily token quota, and records usage per app for billing. Prompts, outputs and
 * keys are never logged, and provider errors are never echoed.
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
});
export type GatewayConfig = z.infer<typeof ConfigSchema>;
export const gatewayConfig = (env: Record<string, string | undefined> = process.env) =>
  ConfigSchema.parse(env);

/** Defaults for new app tokens (per app). */
export const appTokenDefaults = (env: Record<string, string | undefined> = process.env) => ({
  dailyTokenQuota: Number(env.AI_GATEWAY_DAILY_TOKENS ?? 2_000_000),
  requestsPerMinute: Number(env.AI_GATEWAY_RPM ?? 60),
});

const Message = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(200_000),
});

/** Only the fields the orchestrator uses are forwarded; anything else is dropped. */
export function chatBody(body: unknown, cfg: GatewayConfig): Record<string, unknown> {
  const b = z
    .object({
      model: z.string(),
      messages: z.array(Message).min(1).max(100),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().positive().optional(),
      response_format: z.object({ type: z.enum(["json_object", "text"]) }).optional(),
      stream: z.literal(false).optional(),
    })
    .parse(body);
  if (!list(cfg.AI_GATEWAY_CHAT_MODELS).includes(b.model))
    throw new GatewayError(400, "Model not allowed");
  return {
    model: b.model,
    messages: b.messages,
    temperature: b.temperature ?? 0.2,
    max_tokens: Math.min(b.max_tokens ?? 1200, cfg.AI_GATEWAY_MAX_OUTPUT_TOKENS),
    ...(b.response_format ? { response_format: b.response_format } : {}),
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

export interface GatewayDeps {
  verifyToken: (token: string) => Promise<AiApp | null>;
  admit: (app: AiApp) => Promise<AdmitResult>;
  record: (u: {
    appId: string;
    endpoint: GatewayKind;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }) => Promise<void>;
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

  let res: Response;
  try {
    res = await deps.fetch(upstream.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstream.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.AI_GATEWAY_TIMEOUT_MS),
    });
  } catch {
    return problem(504, "AI provider did not respond");
  }
  if (!res.ok) {
    // Provider bodies may contain request details or account data: never echoed.
    return problem(
      res.status === 429 ? 429 : 502,
      res.status === 429 ? "AI provider busy, retry later" : "AI provider error",
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return problem(502, "AI provider error");
  }
  const usage = usageOf(kind, json);
  await deps
    .record({ appId: app.id, endpoint: kind, model: String(body.model), ...usage })
    .catch(() => undefined);
  return Response.json(json, { headers: { "Cache-Control": "no-store" } });
}

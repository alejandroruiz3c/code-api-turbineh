import { z } from "zod";
import { UserFacingError } from "@/security/errors";

/**
 * Transport of the TurbineH orchestrator client (component ai.orchestrator.turbineh). The only place in the app
 * allowed to talk to a model endpoint (TurbineH rule turbineh.ai-direct-model-call).
 *
 * Two modes, chosen by configuration only:
 *  - default: the TurbineH AI gateway with this app's token. TurbineH orchestrates every request on its side (route,
 *    safety policy, next action); the app keeps its tools and runs them. No provider keys live in the app.
 *  - local: AI_BASE_URL (+ AI_API_KEY, AI_MODEL) and no TURBINEH_AI_TOKEN — any OpenAI-compatible endpoint, e.g. a
 *    self-hosted open model. A plain tool-calling loop without TurbineH orchestration. Safety, limits, usage and audit
 *    still run in the app.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  /** TurbineH AI gateway (root; endpoints live under /v1/…). */
  TURBINEH_AI_URL: z.preprocess(empty, z.url().default("https://software.turbineh.com/v1/ai")),
  /** This app's gateway token (tbh_ai_…): from the build page, or set by "Deploy for me". */
  TURBINEH_AI_TOKEN: z.preprocess(empty, z.string().min(1).optional()),
  AI_EMBEDDING_MODEL: z.preprocess(empty, z.string().min(1).default("qwen3-embedding-8b")),
  /** Any OpenAI-compatible endpoint (base URL including its version path, e.g. https://host/v1). Optional. */
  AI_BASE_URL: z.preprocess(empty, z.url().optional()),
  /** Bearer key for AI_BASE_URL (never logged). */
  AI_API_KEY: z.preprocess(empty, z.string().min(1).optional()),
  /** Model served by AI_BASE_URL (local mode). */
  AI_MODEL: z.preprocess(empty, z.string().min(1).max(120).default("default")),
  AI_TIMEOUT_MS: z.preprocess(
    empty,
    z.coerce.number().int().min(1000).max(290_000).default(60_000),
  ),
});
export type AiConfig = z.infer<typeof Env>;
/** Parsed on every call (cheap), so tests and long-running servers always see the current environment. */
export const aiConfig = (): AiConfig => Env.parse(process.env);

/** Where AI calls go: the TurbineH AI gateway, or an OpenAI-compatible endpoint (local mode). */
export function modelEndpoint(cfg: AiConfig = aiConfig()): {
  baseUrl: string;
  key: string | undefined;
  kind: "gateway" | "openai-compatible";
} {
  if (cfg.AI_BASE_URL && !cfg.TURBINEH_AI_TOKEN)
    return {
      baseUrl: cfg.AI_BASE_URL.replace(/\/$/, ""),
      key: cfg.AI_API_KEY,
      kind: "openai-compatible",
    };
  return {
    baseUrl: `${cfg.TURBINEH_AI_URL.replace(/\/$/, "")}/v1`,
    key: cfg.TURBINEH_AI_TOKEN,
    kind: "gateway",
  };
}

/** Fixed vector size of the knowledge base (pgvector column); models with more dimensions are truncated (MRL). */
export const EMBEDDING_DIMENSIONS = 1024;

/** Transport failure. The message is safe to log; provider responses are never echoed. */
export class AiTransportError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * The account behind this app's TurbineH AI token reached its trial limit. The message comes from TurbineH and is
 * meant for the person using the app (who to contact to continue).
 */
export class AiTrialLimitError extends UserFacingError {
  readonly code = "trial_limit_reached";
}

/** TurbineH refused the request as unsafe (its message is safe to show). */
export class AiRefusedError extends UserFacingError {}

const TRIAL_FALLBACK =
  "You've reached the trial limit of the TurbineH orchestration. Contact alex.ruiz@turbineh.com to continue.";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A tool call requested by a model (OpenAI-compatible shape). */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Messages of a tool-calling conversation (runAgent). */
export type AgentChatMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Tool offered to a model: name, description and JSON Schema of its arguments. */
export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attempts per request for transient transport failures (network errors, rate limits, server errors). */
export const TRANSPORT_ATTEMPTS = 2;

/**
 * POST to the configured endpoint within `timeoutMs` (default AI_TIMEOUT_MS). Transient failures are retried once;
 * a trial limit or a refusal is raised at once with the message TurbineH sent for the person.
 */
export async function post(path: string, body: unknown, timeoutMs?: number): Promise<unknown> {
  const cfg = aiConfig();
  const endpoint = modelEndpoint(cfg);
  const deadline = Date.now() + (timeoutMs ?? cfg.AI_TIMEOUT_MS);
  for (let attempt = 0; ; attempt++) {
    // 0 = network failure, timeout or an unreadable body.
    let status = 0;
    try {
      const res = await fetch(`${endpoint.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      status = res.status;
      if (res.ok) return (await res.json()) as unknown;
      if (endpoint.kind === "gateway" && (status === 402 || status === 422)) {
        const problem = (await res.json().catch(() => ({}))) as {
          code?: unknown;
          detail?: unknown;
          title?: unknown;
        };
        const message = typeof problem.detail === "string" ? problem.detail : problem.title;
        if (status === 402 || problem.code === "trial_limit_reached")
          throw new AiTrialLimitError(
            typeof message === "string" && message.includes("@") ? message : TRIAL_FALLBACK,
          );
        throw new AiRefusedError("This request can't be processed. Please rephrase it.");
      }
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      status = 0;
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    const backoff = status === 429 ? 1000 : 400;
    if (!retryable || attempt + 1 >= TRANSPORT_ATTEMPTS || deadline - Date.now() < backoff + 1000)
      throw new AiTransportError(`AI endpoint failed (${status || "network"})`, status);
    await sleep(backoff);
  }
}

const ToolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function").default("function"),
  function: z.object({ name: z.string().min(1).max(64), arguments: z.string().max(20_000) }),
});
const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(ToolCallSchema).nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .partial()
    .optional(),
});

export interface ToolModelReply extends ModelReply {
  toolCalls: ToolCall[];
}

/** One model call on the OpenAI-compatible endpoint (local mode only). */
export async function chatWithTools(
  messages: AgentChatMessage[],
  tools: ModelTool[],
  opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ToolModelReply> {
  const data = ChatResponse.safeParse(
    await post(
      "/chat/completions",
      {
        model: aiConfig().AI_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
              tool_choice: "auto",
            }
          : {}),
      },
      opts.timeoutMs,
    ),
  );
  if (!data.success) throw new AiTransportError("model endpoint returned an unexpected response");
  const message = data.data.choices[0]?.message;
  return {
    text: message?.content ?? "",
    toolCalls: (message?.tool_calls ?? []).map((c) => ({ ...c, type: "function" as const })),
    inputTokens: Math.round(data.data.usage?.prompt_tokens ?? 0),
    outputTokens: Math.round(data.data.usage?.completion_tokens ?? 0),
  };
}

/** Truncates to the fixed size and re-normalises (valid for Matryoshka-trained embedding models). */
export function normalizeEmbedding(vector: number[], dims = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length < dims)
    throw new AiTransportError(`embedding has ${vector.length} dimensions, need ${dims}`);
  const v = vector.slice(0, dims);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const EmbeddingResponse = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
  usage: z.object({ prompt_tokens: z.number() }).partial().optional(),
});

export async function embedTexts(
  texts: string[],
): Promise<{ vectors: number[][]; inputTokens: number }> {
  const data = EmbeddingResponse.safeParse(
    await post("/embeddings", {
      model: aiConfig().AI_EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    }),
  );
  if (!data.success || data.data.data.length !== texts.length) {
    throw new AiTransportError("embedding endpoint returned an unexpected response");
  }
  const vectors = [...data.data.data]
    .sort((a, b) => a.index - b.index)
    .map((d) => normalizeEmbedding(d.embedding));
  return { vectors, inputTokens: Math.round(data.data.usage?.prompt_tokens ?? 0) };
}

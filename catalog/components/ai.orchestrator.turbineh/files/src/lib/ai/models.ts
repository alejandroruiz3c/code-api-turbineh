import { z } from "zod";

/**
 * Orchestrator transport to open models (component ai.orchestrator.turbineh, ADR-0028/ADR-0029/ADR-0033). With
 * decider.ts, the only place in the app allowed to call a model (TurbineH rule turbineh.ai-direct-model-call).
 *
 * Model endpoint, chosen by configuration only:
 *  - default: the TurbineH AI gateway with this app's token (no model-provider or decider keys live in the app);
 *  - AI_BASE_URL (+ AI_API_KEY, AI_MODEL): any OpenAI-compatible endpoint, e.g. a self-hosted open model or the local
 *    mock used by the E2E tests. Safety, limits, usage and audit still run in the orchestrator.
 * Defaults are documented open models served in the EU.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  /** TurbineH AI gateway (root; endpoints live under /v1/…). */
  TURBINEH_AI_URL: z.preprocess(empty, z.url().default("https://software.turbineh.com/v1/ai")),
  /** This app's gateway token (tbh_ai_…): from the build page, or set by "Deploy for me". */
  TURBINEH_AI_TOKEN: z.preprocess(empty, z.string().min(1).optional()),
  /** Small open model that decomposes each request into a plan for the decider. */
  AI_STRUCTURER_MODEL: z.preprocess(empty, z.string().min(1).default("gemma-4-26b-a4b-it")),
  /** Routes the decider can choose: name=model pairs, from cheapest to most capable. */
  AI_ROUTES: z.preprocess(
    empty,
    z.string().default("fast=gemma-4-26b-a4b-it,balanced=deepseek-v4-flash-0731,frontier=glm-5.2"),
  ),
  AI_EMBEDDING_MODEL: z.preprocess(empty, z.string().min(1).default("qwen3-embedding-8b")),
  /** Any OpenAI-compatible endpoint (base URL including its version path, e.g. https://host/v1). Optional. */
  AI_BASE_URL: z.preprocess(empty, z.url().optional()),
  /** Bearer key for AI_BASE_URL (never logged). */
  AI_API_KEY: z.preprocess(empty, z.string().min(1).optional()),
  /** Model served by AI_BASE_URL; when set, every route and the planner use it. */
  AI_MODEL: z.preprocess(empty, z.string().min(1).max(120).optional()),
  AI_TIMEOUT_MS: z.preprocess(
    empty,
    z.coerce.number().int().min(1000).max(290_000).default(60_000),
  ),
});
export type AiConfig = z.infer<typeof Env>;
/** Parsed on every call (cheap), so tests and long-running servers always see the current environment. */
export const aiConfig = (): AiConfig => {
  const cfg = Env.parse(process.env);
  return cfg.AI_MODEL ? { ...cfg, AI_STRUCTURER_MODEL: cfg.AI_MODEL } : cfg;
};

/** Where model calls go: an OpenAI-compatible endpoint from AI_BASE_URL, or the TurbineH AI gateway. */
export function modelEndpoint(cfg: AiConfig = aiConfig()): {
  baseUrl: string;
  key: string | undefined;
  kind: "gateway" | "openai-compatible";
} {
  if (cfg.AI_BASE_URL)
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

export interface Route {
  name: string;
  model: string;
  description: string;
}

const ROUTE_DESCRIPTIONS: Record<string, string> = {
  fast: "Short, simple or routine tasks: classification, extraction, short factual answers.",
  balanced: "Most tasks: explanations, summaries, answers that combine several facts.",
  frontier: "Hard tasks: long documents, careful multi-step reasoning, high-stakes answers.",
};

/** "fast=model-a,balanced=model-b" → routes (invalid entries are ignored; at least one is required). */
export function parseRoutes(spec: string): Route[] {
  const routes = spec
    .split(",")
    .map((pair) => pair.trim().split("="))
    .filter(
      (p): p is [string, string] =>
        p.length === 2 && /^[a-z][a-z0-9-]{0,31}$/.test(p[0] ?? "") && Boolean(p[1]),
    )
    .map(([name, model]) => ({
      name,
      model: model.trim(),
      description: ROUTE_DESCRIPTIONS[name] ?? name,
    }));
  if (routes.length === 0) throw new Error("AI_ROUTES has no valid name=model pair");
  return routes;
}

/** Routes the decider can choose; with AI_MODEL every route uses that one model. */
export const routes = (): Route[] => {
  const cfg = aiConfig();
  const all = parseRoutes(cfg.AI_ROUTES);
  return cfg.AI_MODEL ? all.map((r) => ({ ...r, model: cfg.AI_MODEL as string })) : all;
};

/** Transport failure. The message is safe to log; provider responses are never echoed. */
export class AiTransportError extends Error {}

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

/** POST with timeout and up to 2 retries on rate limits, server errors and network failures. */
async function post(path: string, body: unknown, timeoutMs?: number): Promise<unknown> {
  const cfg = aiConfig();
  const endpoint = modelEndpoint(cfg);
  for (let attempt = 0; ; attempt++) {
    // 0 = network failure, timeout or an unreadable body.
    let status: number;
    try {
      const res = await fetch(`${endpoint.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? cfg.AI_TIMEOUT_MS),
      });
      status = res.status;
      if (res.ok) return (await res.json()) as unknown;
    } catch {
      status = 0;
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt >= 2)
      throw new AiTransportError(`model endpoint failed (${status || "network"})`);
    await sleep(500 * 2 ** attempt);
  }
}

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .partial()
    .optional(),
});

export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: { json?: boolean; maxTokens?: number } = {},
): Promise<ModelReply> {
  const data = ChatResponse.safeParse(
    await post("/chat/completions", {
      model,
      messages,
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  );
  if (!data.success) throw new AiTransportError("model endpoint returned an unexpected response");
  return {
    text: data.data.choices[0]?.message.content ?? "",
    inputTokens: Math.round(data.data.usage?.prompt_tokens ?? 0),
    outputTokens: Math.round(data.data.usage?.completion_tokens ?? 0),
  };
}

const ToolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function").default("function"),
  function: z.object({ name: z.string().min(1).max(64), arguments: z.string().max(20_000) }),
});
const ToolChatResponse = z.object({
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

/** One step of a tool-calling conversation (used only by runAgent in agent.ts). */
export async function chatWithTools(
  model: string,
  messages: AgentChatMessage[],
  tools: ModelTool[],
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<ToolModelReply> {
  const data = ToolChatResponse.safeParse(
    await post(
      "/chat/completions",
      {
        model,
        messages,
        temperature: 0.1,
        max_tokens: opts.maxTokens ?? 800,
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

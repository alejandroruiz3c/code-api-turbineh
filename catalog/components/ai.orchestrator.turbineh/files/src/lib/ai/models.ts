import { z } from "zod";

/**
 * Orchestrator transport to open models (component ai.orchestrator.turbineh, ADR-0028). With decider.ts, the only
 * place in the app allowed to call a model (TurbineH rule turbineh.ai-direct-model-call). Any OpenAI-compatible
 * endpoint works; defaults are documented open models served in the EU (Scaleway Generative APIs).
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  AI_BASE_URL: z.preprocess(empty, z.url().default("https://api.scaleway.ai/v1")),
  AI_API_KEY: z.preprocess(empty, z.string().min(1).optional()),
  /** Small open model that decomposes each request into a plan for the decider. */
  AI_STRUCTURER_MODEL: z.preprocess(empty, z.string().min(1).default("gemma-4-26b-a4b-it")),
  /** Routes the decider can choose: name=model pairs, from cheapest to most capable. */
  AI_ROUTES: z.preprocess(
    empty,
    z.string().default("fast=gemma-4-26b-a4b-it,balanced=deepseek-v4-flash-0731,frontier=glm-5.2"),
  ),
  AI_EMBEDDING_MODEL: z.preprocess(empty, z.string().min(1).default("qwen3-embedding-8b")),
  AI_TIMEOUT_MS: z.preprocess(
    empty,
    z.coerce.number().int().min(1000).max(290_000).default(60_000),
  ),
});
let cached: z.infer<typeof Env> | undefined;
export const aiConfig = () => (cached ??= Env.parse(process.env));

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

export const routes = () => parseRoutes(aiConfig().AI_ROUTES);

/** Transport failure. The message is safe to log; provider responses are never echoed. */
export class AiTransportError extends Error {}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with timeout and up to 2 retries on rate limits, server errors and network failures. */
async function post(path: string, body: unknown): Promise<unknown> {
  const cfg = aiConfig();
  for (let attempt = 0; ; attempt++) {
    // 0 = network failure, timeout or an unreadable body.
    let status: number;
    try {
      const res = await fetch(`${cfg.AI_BASE_URL.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.AI_API_KEY ? { Authorization: `Bearer ${cfg.AI_API_KEY}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.AI_TIMEOUT_MS),
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

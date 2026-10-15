import type { Env } from "@turbineh/shared";
import OpenAI from "openai";

export interface Embedder {
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Open embedding model behind an OpenAI-compatible endpoint, batched. */
export function embedderFromEnv(env: Env, batchSize = 64): Embedder {
  const client = new OpenAI({
    baseURL: env.EMBEDDINGS_BASE_URL ?? env.COMPILER_BASE_URL,
    apiKey: env.EMBEDDINGS_API_KEY ?? env.COMPILER_API_KEY ?? "local",
    maxRetries: 3,
  });
  return {
    model: env.EMBEDDINGS_MODEL,
    dimensions: env.EMBEDDINGS_DIMENSIONS,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const res = await client.embeddings.create({
          model: env.EMBEDDINGS_MODEL,
          input: texts.slice(i, i + batchSize),
          dimensions: env.EMBEDDINGS_DIMENSIONS,
        });
        out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      }
      return out;
    },
  };
}

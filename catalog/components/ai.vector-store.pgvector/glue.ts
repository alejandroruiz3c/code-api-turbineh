import pgvector from "pgvector";

/** Embedding → pgvector SQL literal ("[0.1,0.2]") for parameterised queries. Rejects non-finite values. */
export function toVectorSql(embedding: number[]): string {
  if (!embedding.length || embedding.some((x) => !Number.isFinite(x)))
    throw new Error("Invalid embedding");
  return pgvector.toSql(embedding) as string;
}

export function fromVectorSql(value: string): number[] {
  return pgvector.fromSql(value) as number[];
}

/** Cosine similarity in [-1, 1] (for re-ranking a few candidates in memory). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error("Vectors must have the same length");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

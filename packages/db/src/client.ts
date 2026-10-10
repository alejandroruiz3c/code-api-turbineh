import pg from "pg";

let pool: pg.Pool | undefined;

/** Shared connection pool (one per process). */
export function getPool(databaseUrl: string): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** pgvector literal for a numeric embedding. */
export function toVector(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

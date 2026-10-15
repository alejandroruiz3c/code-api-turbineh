import pg from "pg";

let pool: pg.Pool | undefined;

/** Shared connection pool (one per process). */
/**
 * Shared connection pool (one per process). With DATABASE_CA_CERT (base64 PEM) the connection uses TLS and verifies
 * the server certificate against that CA (managed Postgres); without it, plain local connections are used.
 */
export function getPool(databaseUrl: string): pg.Pool {
  const ca = process.env.DATABASE_CA_CERT;
  pool ??= new pg.Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ...(ca
      ? { ssl: { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true } }
      : {}),
  });
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

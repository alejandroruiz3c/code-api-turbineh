import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "@/env";
import * as schema from "./schema";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });

/** A transaction opened with `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Where a write goes: the database, or the transaction of the change it belongs to. A change and its audit entry
 * (and history) are written in the same transaction, so neither exists without the other (ADR-0054).
 */
export type Executor = typeof db | Transaction;

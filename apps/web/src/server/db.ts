import { getPool } from "@turbineh/db";
import { env } from "./env";

import type pg from "pg";

/** Pool created on first use; methods are bound so `db.query(...)` works as usual. */
export const db = new Proxy({} as pg.Pool, {
  get: (_t, key: string) => {
    const pool = getPool(env.DATABASE_URL);
    const v = Reflect.get(pool, key) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(pool) : v;
  },
});

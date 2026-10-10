import { getPool } from "@turbineh/db";
import { env } from "./env";

export const db = getPool(env.DATABASE_URL);

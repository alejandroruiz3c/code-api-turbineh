import { createHash } from "node:crypto";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { AI_TOKEN_PREFIX, createAiAppToken, verifyAiAppToken } from "./ai-gateway.js";

function fakePool() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    return { rows: sql.includes("INSERT INTO ai_apps") ? [{ id: "app-1" }] : [], rowCount: 1 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool: pool as unknown as pg.Pool, queries };
}

describe("AI app tokens", () => {
  it("returns the token once and stores only its hash; rotation revokes the previous one", async () => {
    const { pool, queries } = fakePool();
    const t = await createAiAppToken(pool, {
      ownerId: "user:1",
      buildId: "b1",
      name: "Support assistant",
      dailyTokenQuota: 1000,
      requestsPerMinute: 10,
    });
    expect(t.token.startsWith(AI_TOKEN_PREFIX)).toBe(true);
    expect(t.token.length).toBeGreaterThan(40);
    const all = JSON.stringify(queries.map((q) => q.params));
    expect(all).not.toContain(t.token);
    expect(all).toContain(createHash("sha256").update(t.token).digest("hex"));
    expect(queries.some((q) => q.sql.includes("SET revoked_at = now()"))).toBe(true);
    expect(queries.map((q) => q.sql)).toContain("COMMIT");
  });

  it("rejects malformed tokens without touching the database", async () => {
    const { pool, queries } = fakePool();
    expect(await verifyAiAppToken(pool, "sk-not-ours")).toBeNull();
    expect(await verifyAiAppToken(pool, `${AI_TOKEN_PREFIX}${"x".repeat(200)}`)).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

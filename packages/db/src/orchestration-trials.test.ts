import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiOwnerSpend, verifyAiAppToken } from "./ai-gateway.js";
import { closePool } from "./client.js";
import { migrate } from "./migrate.js";
import {
  listOrchestrationTrials,
  provisionOrchestrationTrial,
  recentTrialSignups,
  trialOwnerId,
} from "./orchestration-trials.js";

const input = {
  email: "ada@example.com",
  name: "Ada",
  company: "Analytical",
  useCase: "Support routing",
  ipHash: "iphash",
  dailyTokenQuota: 1000,
  requestsPerMinute: 10,
};

function fakePool() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes("INSERT INTO ai_apps")) return { rows: [{ id: "app-1" }], rowCount: 1 };
    if (sql.includes("INSERT INTO orchestration_trials"))
      return { rows: [{ signups: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool: pool as unknown as pg.Pool, queries };
}

describe("orchestration trials (ADR-0059)", () => {
  it("one stable build-less account per email (case-insensitive)", () => {
    expect(trialOwnerId("Ada@Example.com ")).toBe(trialOwnerId("ada@example.com"));
    expect(trialOwnerId("ada@example.com")).toMatch(/^trial:[0-9a-f]{24}$/);
    expect(trialOwnerId("ada@example.com")).not.toContain("ada");
  });

  it("provisions in one transaction: account, signup, revoke build-less tokens, new token (hash only)", async () => {
    const { pool, queries } = fakePool();
    const t = await provisionOrchestrationTrial(pool, input);
    expect(t.token.startsWith("tbh_ai_")).toBe(true);
    expect(t.existing).toBe(false);
    const sql = queries.map((q) => q.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.some((s) => s.includes("build_id IS NULL AND revoked_at IS NULL"))).toBe(true);
    const insert = queries.find((q) => q.sql.includes("INSERT INTO ai_apps"));
    expect(insert?.params[1]).toBeNull();
    const all = JSON.stringify(queries.map((q) => q.params));
    expect(all).not.toContain(t.token);
    expect(all).toContain(createHash("sha256").update(t.token).digest("hex"));
  });
});

// Against a real Postgres (TEST_DATABASE_URL: a throwaway database; every migration is applied); skipped without one.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("orchestration trials in Postgres", () => {
  let db: pg.Pool;
  beforeAll(async () => {
    await migrate(url ?? "");
    db = new pg.Pool({ connectionString: url });
    await db.query("DELETE FROM orchestration_trial_signups");
    await db.query("DELETE FROM orchestration_trials");
    await db.query("DELETE FROM ai_apps WHERE owner_id LIKE 'trial:%'");
  });
  afterAll(async () => {
    await db.end();
    await closePool();
  });

  it("a repeat signup keeps the account and its spend, rotates the token and counts the signups", async () => {
    const first = await provisionOrchestrationTrial(db, input);
    expect(first.existing).toBe(false);
    expect(await verifyAiAppToken(db, first.token)).toMatchObject({
      ownerId: trialOwnerId(input.email),
      buildId: null,
    });
    await db.query(
      "INSERT INTO ai_owner_spend (owner_id, spent_usd) VALUES ($1, 0.5) ON CONFLICT (owner_id) DO UPDATE SET spent_usd = 0.5",
      [first.ownerId],
    );
    const second = await provisionOrchestrationTrial(db, { ...input, company: null, ipHash: null });
    expect(second.existing).toBe(true);
    expect(second.ownerId).toBe(first.ownerId);
    expect(await verifyAiAppToken(db, first.token)).toBeNull();
    expect(await verifyAiAppToken(db, second.token)).not.toBeNull();
    expect(await aiOwnerSpend(db, first.ownerId)).toBeCloseTo(0.5);
    expect(await recentTrialSignups(db, { ownerId: first.ownerId, ipHash: "iphash" })).toEqual({
      byOwner: 2,
      byIp: 1,
      total: 2,
    });
    const [row] = await listOrchestrationTrials(db, 10);
    expect(row).toMatchObject({
      email: "ada@example.com",
      company: "Analytical",
      signups: 2,
      spent_usd: 0.5,
      active_prefix: second.prefix,
    });
  });
});

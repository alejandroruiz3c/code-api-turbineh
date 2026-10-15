import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAiOwnerSpend, aiOwnerSpend, trialStatus } from "./ai-gateway.js";

describe("trial status (ADR-0053)", () => {
  it("below, at and over the cap; no cap when it is 0", () => {
    expect(trialStatus(1.5, 2)).toEqual({
      spentUsd: 1.5,
      capUsd: 2,
      remainingUsd: 0.5,
      reached: false,
    });
    expect(trialStatus(2, 2).reached).toBe(true);
    expect(trialStatus(2.3, 2)).toMatchObject({ remainingUsd: 0, reached: true });
    expect(trialStatus(50, 0).reached).toBe(false);
  });
});

// Atomic increments against a real Postgres (TEST_DATABASE_URL, e.g. a throwaway container); skipped without one.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("trial spend in Postgres", () => {
  let db: pg.Pool;
  beforeAll(async () => {
    db = new pg.Pool({ connectionString: url });
    await db.query("DROP TABLE IF EXISTS ai_owner_spend");
    const { readFileSync } = await import("node:fs");
    await db.query(
      readFileSync(new URL("../migrations/0012_ai_trial_spend.sql", import.meta.url), "utf8"),
    );
  });
  afterAll(async () => {
    await db.query("DROP TABLE IF EXISTS ai_owner_spend");
    await db.end();
  });

  it("adds concurrent costs of every app of an account without losing any", async () => {
    expect(await aiOwnerSpend(db, "user:1")).toBe(0);
    await Promise.all(Array.from({ length: 50 }, () => addAiOwnerSpend(db, "user:1", 0.04)));
    expect(await aiOwnerSpend(db, "user:1")).toBeCloseTo(2, 8);
    expect(await addAiOwnerSpend(db, "user:1", -5)).toBeCloseTo(2, 8);
    expect(await aiOwnerSpend(db, "user:2")).toBe(0);
  });
});

import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost/db";
  process.env.BETTER_AUTH_SECRET = "s".repeat(40);
  process.env.BETTER_AUTH_URL = "https://example.test";
  process.env.GITHUB_CLIENT_ID = "x";
  process.env.GITHUB_CLIENT_SECRET = "x";
  process.env.DELIVERY_TOKEN_KEY = "k".repeat(44);
  process.env.PRODUCT_ACCESS_TOKEN = "TEST_ACCESS_TOKEN_123";
  process.env.OPS_ADMIN_EMAILS = "Staff@Example.test";
  process.env.OPS_OWNER_IDS = "ops:smoke";
});

describe("internal operations data", () => {
  it("only staff and internal keys are ops; clients never get cost", async () => {
    const { clientMetrics, isOps } = await import("./ops");
    const session = (email: string) =>
      ({ kind: "session", ownerId: "user:1", userId: "1", name: "n", email }) as const;
    const key = (ownerId: string) =>
      ({ kind: "api-key", ownerId, apiKeyId: "k", dailyQuota: 1 }) as const;
    expect(isOps(session("staff@example.test"))).toBe(true);
    expect(isOps(session("client@example.test"))).toBe(false);
    expect(isOps(key("ops:smoke"))).toBe(true);
    expect(isOps(key("user:42"))).toBe(false);
    expect(isOps(null)).toBe(false);
    expect(clientMetrics({ cost: { totalEur: 0.01 }, reuse: { reusedShare: 0.8 } })).toEqual({
      reuse: { reusedShare: 0.8 },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner usage report wiring (ADR-0061): channel recording, staff access (incl. the GitHub session behind the
// invitation cookie), the cron's secret, schedule and staging dry run, the report endpoint and "send now".

const state = {
  caller: null as null | Record<string, unknown>,
  session: null as null | { user: { id: string; email: string } },
  headers: new Headers(),
};
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("./caller", () => ({ getCaller: async () => state.caller }));
vi.mock("./auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("./db", () => ({ db: {} }));
vi.mock("./ai-gateway-deps", () => ({
  gatewayEnvConfig: () => ({ AI_TRIAL_CAP_USD: 2, AI_TRIAL_EXEMPT_OWNERS: "ops:smoke" }),
}));
const report = {
  window: { since: null, until: "2026-10-19T06:00:00.000Z" },
  people: [],
  library: { rows: [] },
  orchestration: { rows: [] },
};
const ownerUsageReport = vi.fn(async () => report);
const sendOwnerReport = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  status: "sent",
  period: "2026-W43",
  id: "e1",
}));
const weeklyReportDue = vi.fn(() => true);
vi.mock("@turbineh/db", () => ({
  DEFAULT_OWNER_REPORT_EMAIL: "alex.ruiz@turbineh.com",
  ownerUsageReport,
  sendOwnerReport,
  weeklyReportDue,
  ownerReportCsv: (_r: unknown, view: string) => `view,${view}\r\n`,
}));

beforeEach(() => {
  // env.ts caches the parsed environment: fresh modules per test.
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
  vi.stubEnv("BETTER_AUTH_URL", "https://software.turbineh.com");
  vi.stubEnv("GITHUB_CLIENT_ID", "x");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "x");
  vi.stubEnv("DELIVERY_TOKEN_KEY", "k".repeat(44));
  vi.stubEnv("PRODUCT_ACCESS_TOKEN", "TEST_ACCESS_TOKEN_123");
  vi.stubEnv("OPS_ADMIN_EMAILS", "Staff@Example.test");
  vi.stubEnv("OPS_OWNER_IDS", "ops:smoke");
  vi.stubEnv("CRON_SECRET", "cron-secret-value-0123456789");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  state.caller = null;
  state.session = null;
  state.headers = new Headers();
  sendOwnerReport.mockClear();
  weeklyReportDue.mockReturnValue(true);
});

describe("channel of a flow", () => {
  it("cli, mcp, api or web from the request", async () => {
    const { requestChannel } = await import("./channel");
    const h = (o: Record<string, string>) => new Headers(o);
    expect(
      requestChannel(h({ "user-agent": "turbineh-cli/0.1.0", authorization: "Bearer x" })),
    ).toBe("cli");
    expect(
      requestChannel(h({ "user-agent": "turbineh-cli/0.1.0 mcp", authorization: "Bearer x" })),
    ).toBe("mcp");
    expect(requestChannel(h({ "user-agent": "curl/8", authorization: "Bearer tbh_x" }))).toBe(
      "api",
    );
    expect(requestChannel(h({ "user-agent": "Mozilla/5.0" }))).toBe("web");
  });
});

describe("staff access", () => {
  it("staff by API key or session; a staff GitHub session counts even behind the invitation cookie", async () => {
    const { getStaff } = await import("./staff");
    state.caller = { kind: "api-key", ownerId: "ops:smoke" };
    expect(await getStaff()).toEqual({ via: "api-key", ownerId: "ops:smoke" });
    state.caller = { kind: "access", ownerId: "invite:ws-12345678", workspaceId: "ws-12345678" };
    expect(await getStaff()).toBeNull();
    state.session = { user: { id: "u1", email: "staff@example.test" } };
    expect(await getStaff()).toEqual({ via: "session", ownerId: "user:u1" });
    state.session = { user: { id: "u2", email: "client@example.test" } };
    expect(await getStaff()).toBeNull();
    // A Bearer caller is judged by its key only, never by a cookie session.
    state.session = { user: { id: "u1", email: "staff@example.test" } };
    state.headers = new Headers({ authorization: "Bearer tbh_client" });
    state.caller = { kind: "api-key", ownerId: "user:42" };
    expect(await getStaff()).toBeNull();
  });
});

describe("GET /v1/ops/owner-report", () => {
  it("404 for non-staff; JSON or CSV for staff with a window", async () => {
    const { GET } = await import("@/app/v1/ops/owner-report/route");
    expect((await GET(new Request("https://x.test/v1/ops/owner-report"))).status).toBe(404);
    state.caller = { kind: "api-key", ownerId: "ops:smoke" };
    const json = await GET(
      new Request("https://x.test/v1/ops/owner-report?since=2026-10-01&until=2026-10-15"),
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ window: report.window });
    expect(ownerUsageReport).toHaveBeenLastCalledWith(
      {},
      { since: new Date("2026-10-01"), until: new Date("2026-10-15") },
      { trialCapUsd: 2, exemptOwners: ["ops:smoke"] },
    );
    const csv = await GET(
      new Request("https://x.test/v1/ops/owner-report?format=csv&view=orchestration&days=7"),
    );
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain(
      "turbineh-orchestration-2026-10-19.csv",
    );
    expect(await csv.text()).toBe("view,orchestration\r\n");
  });
});

describe("POST /v1/ops/owner-report/send", () => {
  it("staff only, same-site from the browser, manual send to the configured address", async () => {
    vi.stubEnv("OWNER_REPORT_EMAIL", "owner@example.test");
    const { POST } = await import("@/app/v1/ops/owner-report/send/route");
    const post = (h: Record<string, string> = {}) =>
      POST(
        new Request("https://software.turbineh.com/v1/ops/owner-report/send", {
          method: "POST",
          headers: h,
        }),
      );
    expect((await post()).status).toBe(404);
    state.session = { user: { id: "u1", email: "staff@example.test" } };
    state.caller = { kind: "access", ownerId: "invite:ws-12345678", workspaceId: "ws-12345678" };
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    const res = await post({
      origin: "https://software.turbineh.com",
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://software.turbineh.com/ops/report?sent=sent");
    expect(sendOwnerReport.mock.calls[0]?.[2]).toMatchObject({
      kind: "manual",
      to: "owner@example.test",
      staging: false,
    });
  });
});

describe("GET /v1/cron/owner-report (Vercel Cron)", () => {
  const call = async (
    auth?: string,
    url = "https://software.turbineh.com/v1/cron/owner-report",
  ) => {
    vi.resetModules();
    const { GET } = await import("@/app/v1/cron/owner-report/route");
    return GET(new Request(url, auth ? { headers: { authorization: auth } } : {}));
  };

  it("404 without CRON_SECRET, 401 with a wrong one", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(404);
    vi.stubEnv("CRON_SECRET", "cron-secret-value-0123456789");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(sendOwnerReport).not.toHaveBeenCalled();
  });

  it("not due outside Monday 08:00 Madrid; weekly send in production (default recipient)", async () => {
    weeklyReportDue.mockReturnValue(false);
    expect(await (await call("Bearer cron-secret-value-0123456789")).json()).toEqual({
      status: "not_due",
    });
    weeklyReportDue.mockReturnValue(true);
    const res = await call("Bearer cron-secret-value-0123456789");
    expect(res.status).toBe(200);
    expect(sendOwnerReport.mock.calls[0]?.[2]).toMatchObject({
      kind: "weekly",
      to: "alex.ruiz@turbineh.com",
      staging: false,
      dryRun: false,
    });
  });

  it("staging builds the report but sends nothing unless OWNER_REPORT_CRON_SEND=1", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://staging.software.turbineh.com");
    await call("Bearer cron-secret-value-0123456789");
    expect(sendOwnerReport.mock.calls[0]?.[2]).toMatchObject({ staging: true, dryRun: true });
    vi.stubEnv("OWNER_REPORT_CRON_SEND", "1");
    await call("Bearer cron-secret-value-0123456789");
    expect(sendOwnerReport.mock.calls[1]?.[2]).toMatchObject({ staging: true, dryRun: false });
  });
});

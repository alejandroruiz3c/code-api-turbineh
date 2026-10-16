import type { EmailMessage, Mailer, SendResult } from "@turbineh/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "./client.js";
import { migrate } from "./migrate.js";
import {
  claimWeeklyReport,
  isoWeek,
  madridParts,
  ownerReportEmail,
  recordFlowDownload,
  sendOwnerReport,
  weeklyReportDue,
} from "./owner-report-email.js";
import {
  combinePeople,
  csvField,
  type LibraryRow,
  type OrchestrationRow,
  type OwnerReport,
  ownerReportCsv,
  ownerUsageReport,
} from "./owner-report.js";

function mockMailer(fail = false) {
  const sent: EmailMessage[] = [];
  const mailer: Mailer = {
    from: "TurbineH <support@turbineh.com>",
    ownerAlertTo: "owner@example.com",
    appUrl: "https://software.example.test",
    async send(m): Promise<SendResult> {
      sent.push(m);
      return fail
        ? { ok: false, status: 500, error: "boom" }
        : { ok: true, id: `id-${sent.length}` };
    },
  };
  return { mailer, sent };
}

const lib = (over: Partial<LibraryRow>): LibraryRow => ({
  ownerId: "user:1",
  email: null,
  name: null,
  githubLogin: null,
  emailSource: null,
  accountKind: "user",
  firstSeenAt: null,
  lastActivityAt: null,
  channels: {},
  flows: 0,
  plans: 0,
  packagesGenerated: 0,
  appBuilds: 0,
  improvements: 0,
  verified: 0,
  deliveredUnverified: 0,
  failed: 0,
  notCovered: 0,
  inProgress: 0,
  checksPassed: 0,
  checksTotal: 0,
  requirementsMet: 0,
  requirementsOpen: 0,
  capabilities: [],
  components: [],
  avgSecondsToVerified: null,
  downloads: 0,
  pullRequests: 0,
  githubPushes: 0,
  deploys: 0,
  localApplies: 0,
  uncoveredRequests: 0,
  aiApps: 0,
  aiCalls: 0,
  aiInputTokens: 0,
  aiOutputTokens: 0,
  aiSpentUsd: 0,
  ...over,
});

const orch = (over: Partial<OrchestrationRow>): OrchestrationRow => ({
  ownerId: "trial:1",
  email: null,
  name: null,
  githubLogin: null,
  emailSource: null,
  kind: "trial",
  company: null,
  useCase: null,
  signupAt: null,
  signups: 1,
  lastActivityAt: null,
  requests: 0,
  failedRequests: 0,
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  latencyP50Ms: null,
  latencyP95Ms: null,
  costUsd: 0,
  referenceCostUsd: 0,
  savingsUsd: 0,
  savingsPct: null,
  trial: { capUsd: 2, spentUsd: 0, remainingUsd: 2, reached: false },
  bySurface: {
    apiChat: { requests: 0, costUsd: 0 },
    orchestrate: { requests: 0, costUsd: 0 },
    agent: { requests: 0, costUsd: 0 },
    mcp: { requests: 0, costUsd: 0 },
  },
  ...over,
});

const emptyLib = {
  newAccounts: 0,
  activeAccounts: 0,
  flows: 0,
  verified: 0,
  failed: 0,
  notCovered: 0,
  uncoveredRequests: 0,
  downloads: 0,
  pullRequests: 0,
  deploys: 0,
};
const emptyOrch = {
  newSignups: 0,
  signups: 0,
  activeAccounts: 0,
  requests: 0,
  failedRequests: 0,
  modelCalls: 0,
  costUsd: 0,
  referenceCostUsd: 0,
  savingsUsd: 0,
  savingsPct: null,
};

function fixtureReport(): OwnerReport {
  const l = [
    lib({
      ownerId: "user:1",
      email: "ada@example.com",
      name: "Ada <script>",
      flows: 3,
      channels: { web: 3 },
    }),
  ];
  const o = [
    orch({
      ownerId: "trial:a",
      email: "ada@example.com",
      name: "Ada",
      requests: 5,
      costUsd: 0.01,
      referenceCostUsd: 0.05,
      savingsUsd: 0.04,
      savingsPct: 80,
    }),
    orch({ ownerId: "trial:b", email: "=cmd@example.com", requests: 1 }),
  ];
  return {
    generatedAt: "2026-10-19T06:00:00.000Z",
    window: { since: null, until: "2026-10-19T06:00:00.000Z" },
    week: {
      since: "2026-10-12T06:00:00.000Z",
      until: "2026-10-19T06:00:00.000Z",
      previousSince: "2026-10-05T06:00:00.000Z",
    },
    library: {
      rows: l,
      totals: { ...emptyLib, flows: 3 },
      week: { thisWeek: { ...emptyLib, flows: 3, newAccounts: 1 }, previousWeek: emptyLib },
    },
    orchestration: {
      rows: o,
      totals: { ...emptyOrch, requests: 6 },
      week: {
        thisWeek: { ...emptyOrch, requests: 6, costUsd: 0.01 },
        previousWeek: { ...emptyOrch, requests: 2 },
      },
    },
    people: combinePeople(l, o),
  };
}

describe("owner report (ADR-0061)", () => {
  it("links the same person across products by email and keeps unknown accounts apart", () => {
    const people = combinePeople(
      [
        lib({
          ownerId: "user:1",
          email: "ada@example.com",
          flows: 2,
          verified: 1,
          channels: { cli: 1, web: 1 },
        }),
        lib({ ownerId: "invite:ws-12345678", flows: 1 }),
      ],
      [
        orch({
          ownerId: "trial:a",
          email: "ada@example.com",
          requests: 4,
          costUsd: 0.1,
          savingsUsd: 0.3,
          trial: { capUsd: 2, spentUsd: 0.1, remainingUsd: 1.9, reached: false },
        }),
      ],
    );
    expect(people).toHaveLength(2);
    const ada = people[0];
    expect(ada).toMatchObject({
      key: "ada@example.com",
      ownerIds: ["user:1", "trial:a"],
      products: ["library", "orchestration"],
      library: { flows: 2, verified: 1, channels: ["cli", "web"] },
      orchestration: { requests: 4, costUsd: 0.1, savingsUsd: 0.3, trialRemainingUsd: 1.9 },
    });
    expect(people[1]?.key).toBe("invite:ws-12345678");
  });

  it("CSV quotes, escapes and neutralises formulas", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-1.5)).toBe("-1.5");
    expect(csvField(null)).toBe("");
    expect(csvField(["a", "b"])).toBe("a b");
    const csv = ownerReportCsv(fixtureReport(), "orchestration");
    const [header, first, second] = csv.split("\r\n");
    expect(header?.startsWith("owner_id,kind,email,name,company,use_case,signup_at")).toBe(true);
    expect(header).toContain("frontier_reference_cost_usd,savings_usd,savings_pct");
    expect(header).toContain("mcp_requests,mcp_cost_usd");
    expect(first).toContain("trial:a,trial,ada@example.com,Ada");
    expect(second).toContain("'=cmd@example.com");
    expect(ownerReportCsv(fixtureReport(), "people").split("\r\n")[0]).toContain("library_flows");
  });

  it("weeks and the Monday 08:00 Madrid schedule across daylight saving time", () => {
    expect(isoWeek(new Date("2026-10-19T06:00:00Z"))).toBe("2026-W43");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2026-10-18T22:30:00Z"))).toBe("2026-W43"); // already Monday in Madrid
    // Summer (CEST, UTC+2): the 06:00 UTC run is 08:00 local.
    expect(madridParts(new Date("2026-10-19T06:00:00Z"))).toMatchObject({ weekday: 1, hour: 8 });
    expect(weeklyReportDue(new Date("2026-10-19T06:00:00Z"))).toBe(true);
    // Winter (CET, UTC+1): the 06:00 UTC run is 07:00 local (not yet), the 07:00 UTC run is 08:00.
    expect(weeklyReportDue(new Date("2026-11-02T06:00:00Z"))).toBe(false);
    expect(weeklyReportDue(new Date("2026-11-02T07:00:00Z"))).toBe(true);
    expect(weeklyReportDue(new Date("2026-11-03T07:00:00Z"))).toBe(false);
  });

  it("the email: brand, both products, escaped user text, link and three CSV attachments", () => {
    const e = ownerReportEmail(fixtureReport(), {
      appUrl: "https://software.example.test/",
      period: "2026-W43",
    });
    expect(e.subject).toBe("TurbineH owner report · 2026-W43");
    expect(e.html).toContain("#001a5a");
    expect(e.html).toContain("#fcf6e4");
    expect(e.html).toContain("YES IF library");
    expect(e.html).toContain("Intelligence Orchestration");
    expect(e.html).toContain('href="https://software.example.test/ops/report"');
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("Ada &lt;script&gt;");
    expect(e.text).toContain("Requests: 6 (previous 2, +4)");
    expect(e.attachments.map((a) => a.filename)).toEqual([
      "people-2026-W43.csv",
      "library-2026-W43.csv",
      "orchestration-2026-W43.csv",
    ]);
    const staging = ownerReportEmail(fixtureReport(), {
      appUrl: "https://x.test",
      period: "2026-W43",
      staging: true,
    });
    expect(staging.subject.startsWith("[STAGING] ")).toBe(true);
  });

  it("send: no mailer, bad recipient and dry run send nothing", async () => {
    const build = async () => fixtureReport();
    const db = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
    expect(
      (await sendOwnerReport(db, null, { kind: "manual", to: "o@example.com", build })).status,
    ).toBe("no_mailer");
    const { mailer, sent } = mockMailer();
    expect((await sendOwnerReport(db, mailer, { kind: "manual", to: "a, b", build })).status).toBe(
      "invalid_recipient",
    );
    expect(
      (
        await sendOwnerReport(db, mailer, {
          kind: "manual",
          to: "o@example.com",
          build,
          dryRun: true,
        })
      ).status,
    ).toBe("dry_run");
    expect(sent).toHaveLength(0);
    const r = await sendOwnerReport(db, mailer, { kind: "manual", to: "o@example.com", build });
    expect(r.status).toBe("sent");
    expect(sent[0]?.attachments).toHaveLength(3);
    expect(sent[0]?.idempotencyKey).toBeUndefined();
  });
});

// Against a real Postgres (TEST_DATABASE_URL): a fresh database is created for this file (all migrations applied),
// so other test files sharing the server cannot interfere. Skipped without one.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("owner report in Postgres", () => {
  let admin: pg.Client;
  let db: pg.Pool;
  const name = `owner_report_${process.pid}_${Date.now()}`;
  const T = (d: number, h = 12) =>
    `2020-01-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
  const B = (i: number) => `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(url ?? "");
    u.pathname = `/${name}`;
    await migrate(u.toString());
    await closePool();
    db = new pg.Pool({ connectionString: u.toString() });
    // better-auth's user table (created by `auth:migrate` in the web app), minimal columns.
    await db.query(
      `CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL)`,
    );
    await db.query(`INSERT INTO "user" VALUES ('u1', 'Ada@Example.com', 'Ada Lovelace')`);
    const build = (
      i: number,
      owner: string,
      status: string,
      options: object,
      metrics: object,
      created: string,
      finished: string | null,
      apiKey = false,
    ) =>
      db.query(
        `INSERT INTO builds (id, prompt, status, owner_id, options, metrics, created_at, finished_at, api_key_id)
         VALUES ($1, 'p', $2, $3, $4, $5, $6, $7, $8)`,
        [
          B(i),
          status,
          owner,
          options,
          metrics,
          created,
          finished,
          apiKey ? "11111111-1111-1111-1111-111111111111" : null,
        ],
      );
    // Ada (signed in): a verified package from the web, a verified app from the CLI, a refused request over MCP.
    await build(
      1,
      "user:u1",
      "done",
      { mode: "generate", channel: "web" },
      {
        plan: {
          capability: { id: "commerce.shop" },
          components: [{ id: "auth.better" }, { id: "pay.stripe" }],
        },
        verify: [
          { name: "certification", ok: true },
          { name: "unit", ok: true },
          { name: "typecheck", ok: true },
        ],
        acceptance: { met: 3, covered: 1, open: ["x"] },
      },
      T(2),
      T(2, 13),
    );
    await db.query(
      `INSERT INTO build_events (build_id, phase, type, at) VALUES ($1, 'queued', 'queued', $2)`,
      [B(1), T(2, 12)],
    );
    await build(
      2,
      "user:u1",
      "done",
      { channel: "cli" },
      {
        recipe: { built: "saas-crud" },
        components: ["auth.better", "db.drizzle"],
        delivery: { kind: "verified", checksPassed: 11, checksTotal: 11 },
        handover: { checksPassed: 11, checksTotal: 11 },
      },
      T(3),
      T(3, 12).replace("12:00", "12:30"),
    );
    await build(3, "user:u1", "failed", { mode: "plan", channel: "mcp" }, {}, T(9), T(9));
    await db.query(
      `INSERT INTO use_case_demand (build_id, owner_id, email, request, status, missing, created_at)
       VALUES ($1, 'user:u1', NULL, 'instagram', 'uncovered', '[]', $2)`,
      [B(3), T(9)],
    );
    // A workspace (invitation token) with an unrecorded channel, an unverified delivery and a plain failure.
    await build(
      4,
      "invite:ws-aaaaaaaa",
      "failed",
      {},
      { delivery: { kind: "unverified", checksPassed: 9, checksTotal: 11 } },
      T(4),
      T(4),
    );
    await build(5, "invite:ws-aaaaaaaa", "failed", {}, {}, T(4), T(4));
    // An API key's in-progress build.
    await build(6, "staging-bench", "compiling", {}, {}, T(9), null, true);
    await db.query(
      `INSERT INTO repo_integrations (id, build_id, owner_id, repo, pr_url, created_at) VALUES ('ri1', $1, 'user:u1', 'a/b', 'https://github.com/a/b/pull/1', $2)`,
      [B(1), T(5)],
    );
    await db.query(
      `INSERT INTO deployments (build_id, owner_id, status, db_mode, created_at) VALUES ($1, 'user:u1', 'done', 'neon', $2)`,
      [B(2), T(5)],
    );
    await recordFlowDownload(db, { buildId: B(1), ownerId: "user:u1", format: "zip" });
    await db.query(`UPDATE flow_downloads SET created_at = $1`, [T(6)]);
    await db.query(
      `INSERT INTO github_connections (owner_id, token_enc, login, via) VALUES ('user:u1', 'x', 'ada-gh', 'oauth')`,
    );
    // Ada's generated app uses the AI gateway (by a build token), and she also signed up for an orchestration trial.
    const app = await db.query<{ id: string }>(
      `INSERT INTO ai_apps (owner_id, build_id, name, token_hash, prefix, daily_token_quota, requests_per_minute)
       VALUES ('user:u1', $1, 'shop', 'h1', 'p1', 1000, 10) RETURNING id`,
      [B(2)],
    );
    await db.query(
      `INSERT INTO ai_gateway_usage (app_id, day, endpoint, model, calls, input_tokens, output_tokens)
       VALUES ($1, '2020-01-06', 'chat', 'm', 4, 400, 40)`,
      [app.rows[0]?.id],
    );
    await db.query(`INSERT INTO ai_owner_spend (owner_id, spent_usd) VALUES ('user:u1', 0.25)`);
    await db.query(
      `INSERT INTO orchestration_trials (owner_id, email, name, company, use_case, created_at, last_signup_at)
       VALUES ('trial:ada', 'ada@example.com', 'Ada', 'Engines', 'routing', $1, $1),
              ('trial:bob', 'bob@example.com', 'Bob', NULL, NULL, $2, $2)`,
      [T(8), T(1)],
    );
    await db.query(
      `INSERT INTO orchestration_trial_signups (owner_id, created_at) VALUES ('trial:ada', $1), ('trial:bob', $2)`,
      [T(8), T(1)],
    );
    await db.query(
      `INSERT INTO ai_owner_spend (owner_id, spent_usd) VALUES ('trial:ada', 2.0), ('trial:bob', 0.5)`,
    );
    const metric = (
      owner: string,
      surface: string,
      ok: boolean,
      latency: number,
      cost: number,
      ref: number,
      at: string,
    ) =>
      db.query(
        `INSERT INTO ai_request_metrics (owner_id, app_id, surface, ok, latency_ms, model_calls, input_tokens,
           output_tokens, cost_usd, reference_cost_usd, created_at)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, 2, 100, 10, $5, $6, $7)`,
        [owner, surface, ok, latency, cost, ref, at],
      );
    await metric("trial:ada", "chat", true, 500, 0.001, 0.004, T(8));
    await metric("trial:ada", "orchestrate", true, 900, 0.002, 0.01, T(9));
    await metric("trial:ada", "mcp:chat", false, 3000, 0.001, 0.002, T(9));
    await metric("trial:bob", "agent", true, 700, 0.003, 0.006, T(2));
    // Internal smoke key: exempt from the cap.
    await metric("ops:smoke", "chat-direct", true, 100, 0.0005, 0.001, T(9));
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });

  it("per-account rows, identities, totals and week-over-week for both products", async () => {
    const r = await ownerUsageReport(
      db,
      { until: new Date("2020-01-10T00:00:00Z") },
      { trialCapUsd: 2, exemptOwners: ["ops:smoke"] },
    );

    const ada = r.library.rows.find((x) => x.ownerId === "user:u1");
    expect(ada).toMatchObject({
      email: "ada@example.com",
      name: "Ada Lovelace",
      githubLogin: "ada-gh",
      emailSource: "account",
      accountKind: "user",
      channels: { cli: 1, mcp: 1, web: 1 },
      flows: 3,
      plans: 2,
      packagesGenerated: 1,
      appBuilds: 1,
      verified: 2,
      failed: 0,
      notCovered: 1,
      checksPassed: 13,
      checksTotal: 13,
      requirementsMet: 3,
      requirementsOpen: 1,
      capabilities: ["commerce.shop", "saas-crud"],
      components: ["auth.better", "db.drizzle", "pay.stripe"],
      downloads: 1,
      pullRequests: 1,
      deploys: 1,
      uncoveredRequests: 1,
      aiApps: 1,
      aiCalls: 4,
      aiInputTokens: 400,
      aiSpentUsd: 0.25,
      firstSeenAt: "2020-01-02T12:00:00.000Z",
      lastActivityAt: "2020-01-09T12:00:00.000Z",
    });
    // Package: 1 h from its generation request; app: 30 min → mean 45 min.
    expect(ada?.avgSecondsToVerified).toBe(2700);
    const ws = r.library.rows.find((x) => x.ownerId === "invite:ws-aaaaaaaa");
    expect(ws).toMatchObject({
      accountKind: "workspace",
      email: null,
      channels: { unrecorded: 2 },
      deliveredUnverified: 1,
      failed: 1,
      verified: 0,
      checksPassed: 9,
      checksTotal: 11,
    });
    expect(r.library.rows.find((x) => x.ownerId === "staging-bench")).toMatchObject({
      accountKind: "api_key",
      channels: { api: 1 },
      inProgress: 1,
    });

    const tAda = r.orchestration.rows.find((x) => x.ownerId === "trial:ada");
    expect(tAda).toMatchObject({
      kind: "trial",
      email: "ada@example.com",
      company: "Engines",
      requests: 3,
      failedRequests: 1,
      modelCalls: 6,
      inputTokens: 300,
      outputTokens: 30,
      latencyP50Ms: 500,
      latencyP95Ms: 900,
      costUsd: 0.004,
      referenceCostUsd: 0.016,
      savingsUsd: 0.012,
      savingsPct: 75,
      trial: { capUsd: 2, spentUsd: 2, remainingUsd: 0, reached: true },
      bySurface: {
        apiChat: { requests: 1, costUsd: 0.001 },
        orchestrate: { requests: 1, costUsd: 0.002 },
        agent: { requests: 0, costUsd: 0 },
        mcp: { requests: 1, costUsd: 0.001 },
      },
    });
    expect(r.orchestration.rows.find((x) => x.ownerId === "ops:smoke")).toMatchObject({
      kind: "internal",
      trial: { capUsd: null, remainingUsd: null, reached: false },
    });
    // Ordered by cost.
    expect(r.orchestration.rows[0]?.ownerId).toBe("trial:ada");

    // Ada is one person across both products.
    const person = r.people.find((p) => p.key === "ada@example.com");
    expect(person?.products).toEqual(["library", "orchestration"]);
    expect(person?.ownerIds.sort()).toEqual(["trial:ada", "user:u1"]);

    // Week: 2020-01-03 → 2020-01-10 vs 2019-12-27 → 2020-01-03.
    expect(r.library.week.thisWeek).toMatchObject({
      flows: 5,
      newAccounts: 2,
      activeAccounts: 3,
      verified: 1,
      notCovered: 1,
      downloads: 1,
      pullRequests: 1,
      deploys: 1,
    });
    expect(r.library.week.previousWeek).toMatchObject({ flows: 1, newAccounts: 1, verified: 1 });
    expect(r.orchestration.week.thisWeek).toMatchObject({
      newSignups: 1,
      signups: 1,
      activeAccounts: 2,
      requests: 4,
      failedRequests: 1,
    });
    expect(r.orchestration.week.previousWeek).toMatchObject({
      newSignups: 1,
      requests: 1,
      costUsd: 0.003,
    });
    expect(r.library.totals.flows).toBe(6);
    expect(r.orchestration.totals.requests).toBe(5);

    // A window excludes earlier activity (Bob's only request and signup were on Jan 1–2).
    const late = await ownerUsageReport(db, {
      since: new Date("2020-01-05T00:00:00Z"),
      until: new Date("2020-01-10T00:00:00Z"),
    });
    expect(late.orchestration.rows.map((x) => x.ownerId).sort()).toEqual([
      "ops:smoke",
      "trial:ada",
    ]);
    expect(late.library.rows.find((x) => x.ownerId === "user:u1")?.flows).toBe(1);
  });

  it("the weekly send is claimed once per ISO week, retried after a failure and capped", async () => {
    const build = async () => fixtureReport();
    const now = new Date("2020-01-06T07:00:00Z");
    const failing = mockMailer(true);
    const first = await sendOwnerReport(db, failing.mailer, {
      kind: "weekly",
      to: "o@example.com",
      now,
      build,
    });
    expect(first.status).toBe("failed");
    const ok = mockMailer();
    const [a, b] = await Promise.all([
      sendOwnerReport(db, ok.mailer, { kind: "weekly", to: "o@example.com", now, build }),
      sendOwnerReport(db, ok.mailer, { kind: "weekly", to: "o@example.com", now, build }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["already_sent", "sent"]);
    expect(ok.sent).toHaveLength(1);
    expect(ok.sent[0]?.idempotencyKey).toBe("owner-report-2020-W02-2");
    expect(
      (await sendOwnerReport(db, ok.mailer, { kind: "weekly", to: "o@example.com", now, build }))
        .status,
    ).toBe("already_sent");
    const row = await db.query(
      "SELECT status, attempts, email_id FROM owner_report_sends WHERE period = '2020-W02'",
    );
    expect(row.rows[0]).toEqual({ status: "sent", attempts: 2, email_id: "id-1" });
    // At most 3 attempts for a week that keeps failing.
    const fail = () =>
      db.query("UPDATE owner_report_sends SET status = 'failed' WHERE period = '2020-W03'");
    expect(await claimWeeklyReport(db, "2020-W03")).toBe(1);
    expect(await claimWeeklyReport(db, "2020-W03")).toBeNull(); // in flight
    for (const n of [2, 3]) {
      await fail();
      expect(await claimWeeklyReport(db, "2020-W03")).toBe(n);
    }
    await fail();
    expect(await claimWeeklyReport(db, "2020-W03")).toBeNull();
  });
});

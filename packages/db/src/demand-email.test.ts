import type { Mailer } from "@turbineh/shared";
import { resendMailer } from "@turbineh/shared";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  availableEmail,
  confirmationEmail,
  MAX_EMAIL_ATTEMPTS,
  notifyAvailable,
  ownerAlertEmail,
  sendDemandEmails,
} from "./demand-email.js";
import { parseArgs } from "./notify-available.js";

const XSS = `<script>alert("x")</script>`;
const row = {
  id: 7,
  email: "person@example.com",
  owner_id: "user:1",
  request: `Autonomous social media publisher ${XSS}`,
  status: "uncovered" as const,
  use_case: null,
  missing: [{ requirement: `Publish to Instagram ${XSS}`, why: "external platform" }],
};

/** A Resend mailer over a mocked fetch: records every message sent. */
function mockMailer(status = 200) {
  const sent: { to: string[]; subject: string; html: string; text: string; key?: string }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as (typeof sent)[number];
    const key = (init.headers as Record<string, string>)["Idempotency-Key"];
    sent.push({ ...body, ...(key ? { key } : {}) });
    return status === 200
      ? Response.json({ id: `em_${sent.length}` })
      : Response.json({ name: "application_error" }, { status });
  });
  const mailer = resendMailer({ apiKey: "re_test", fetch: fetchMock as unknown as typeof fetch });
  return { mailer, sent, fetchMock };
}

describe("email content", () => {
  it("confirmation: the promise, the missing requirements, user text escaped", () => {
    const e = confirmationEmail(row, "https://software.turbineh.com");
    expect(e.text).toContain("We don't cover this use case yet.");
    expect(e.text).toContain(
      "You're on the priority list and we'll email you as soon as it's available",
    );
    expect(e.text).toContain("- Publish to Instagram");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(e.subject).not.toContain("Instagram");
    expect(confirmationEmail({ ...row, status: "partial" }, "u").text).toContain(
      "Part of your request",
    );
  });

  it("owner alert and available notice escape user text too", () => {
    expect(ownerAlertEmail(row).html).not.toContain("<script>");
    expect(ownerAlertEmail(row).subject).toBe("Demand #7: uncovered request");
    const a = availableEmail([row.request], "https://software.turbineh.com", `New: ${XSS}`);
    expect(a.html).not.toContain("<script>");
    expect(a.text).toContain("now covers what you asked for");
  });
});

/** In-memory stand-in for the two demand tables, answering the queries demand-email.ts runs. */
function fakeDb(rows: (typeof row & Record<string, unknown>)[]) {
  const state = rows.map((r) => ({
    build_id: `b-${r.id}`,
    confirmation_sent_at: null as Date | null,
    confirmation_attempts: 0,
    owner_alerted_at: null as Date | null,
    owner_alert_attempts: 0,
    available_notified_at: null as Date | null,
    ...r,
  }));
  const priority = new Map<string, Date | null>();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const claim = /SET (confirmation_sent_at|owner_alerted_at) = now\(\), (\w+) = /.exec(sql);
    if (claim) {
      const [, col, attempts] = claim as unknown as [
        string,
        "confirmation_sent_at",
        "confirmation_attempts",
      ];
      const hit = state.filter(
        (r) =>
          r.build_id === params[0] &&
          r[col] === null &&
          r[attempts] < (params[1] as number) &&
          (col !== "confirmation_sent_at" || r.email),
      );
      for (const r of hit) {
        r[col] = new Date();
        r[attempts]++;
      }
      return { rows: hit };
    }
    let m =
      /SET (confirmation_sent_at|owner_alerted_at) = NULL(, confirmation_attempts = \$2)? WHERE id = \$1/.exec(
        sql,
      );
    if (m) {
      const r = state.find((x) => x.id === params[0]);
      if (r) {
        r[m[1] as "confirmation_sent_at"] = null;
        if (m[2]) r.confirmation_attempts = params[1] as number;
      }
      return { rows: [] };
    }
    if (sql.includes("coalesce(d.email, p.email) AS email")) {
      const ids = params[0] as number[];
      const cap = params[1] as string | null;
      return {
        rows: state.filter(
          (r) =>
            r.available_notified_at === null &&
            (ids.includes(r.id) ||
              (cap !== null &&
                (r.use_case === cap ||
                  r.missing.some((x) => x.requirement.toLowerCase().includes(cap.toLowerCase()))))),
        ),
      };
    }
    m = /SET available_notified_at = (now\(\)|NULL)/.exec(sql);
    if (m) {
      const ids = params[0] as number[];
      const hit = state.filter(
        (r) => ids.includes(r.id) && (m?.[1] === "NULL" || r.available_notified_at === null),
      );
      for (const r of hit) r.available_notified_at = m[1] === "NULL" ? null : new Date();
      return { rows: hit.map((r) => ({ id: r.id })) };
    }
    if (sql.includes("UPDATE priority_notifications")) {
      for (const o of params[0] as string[])
        if (!state.some((r) => r.owner_id === o && r.available_notified_at === null))
          priority.set(o, new Date());
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
  return { db: { query } as unknown as Pick<pg.Pool, "query">, state, priority, query };
}

describe("sendDemandEmails", () => {
  it("sends the confirmation and the owner alert once per demand row", async () => {
    const { db, state } = fakeDb([row]);
    const { mailer, sent } = mockMailer();
    expect(await sendDemandEmails(db, mailer, "b-7")).toEqual({
      confirmation: "sent",
      ownerAlert: "sent",
    });
    expect(sent.map((s) => s.to[0])).toEqual(["person@example.com", "alex.ruiz@turbineh.com"]);
    expect(sent[0]?.key).toBe("demand-confirmation-7");
    expect(state[0]?.confirmation_sent_at).toBeInstanceOf(Date);
    // Second caller (web poll after the worker): nothing more is sent.
    expect(await sendDemandEmails(db, mailer, "b-7")).toEqual({
      confirmation: "skipped",
      ownerAlert: "skipped",
    });
    expect(sent).toHaveLength(2);
  });

  it("without a mailer, nothing is touched", async () => {
    const { db, query } = fakeDb([row]);
    expect(await sendDemandEmails(db, null, "b-7")).toEqual({
      confirmation: "skipped",
      ownerAlert: "skipped",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("no email known: the owner is still alerted", async () => {
    const { db } = fakeDb([{ ...row, email: null as unknown as string }]);
    const { mailer, sent } = mockMailer();
    expect(await sendDemandEmails(db, mailer, "b-7")).toEqual({
      confirmation: "skipped",
      ownerAlert: "sent",
    });
    expect(sent.map((s) => s.to[0])).toEqual(["alex.ruiz@turbineh.com"]);
  });

  it("a failed send is released for a retry, logged without personal data, and never throws", async () => {
    const { db, state } = fakeDb([row]);
    const { mailer } = mockMailer(500);
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    expect(await sendDemandEmails(db, mailer, "b-7", log)).toEqual({
      confirmation: "failed",
      ownerAlert: "failed",
    });
    expect(state[0]?.confirmation_sent_at).toBeNull();
    expect(state[0]?.confirmation_attempts).toBe(1);
    const logged = JSON.stringify(log.error.mock.calls);
    expect(logged).not.toContain("person@example.com");
    expect(logged).not.toContain("Instagram");
    // Gives up after MAX_EMAIL_ATTEMPTS.
    for (let i = 1; i < MAX_EMAIL_ATTEMPTS + 2; i++) await sendDemandEmails(db, mailer, "b-7", log);
    expect(state[0]?.confirmation_attempts).toBe(MAX_EMAIL_ATTEMPTS);
  });

  it("a database error is logged, not thrown", async () => {
    const db = { query: vi.fn(async () => Promise.reject(new Error("relation does not exist"))) };
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const { mailer } = mockMailer();
    await expect(
      sendDemandEmails(db as unknown as pg.Pool, mailer, "b-7", log),
    ).resolves.toBeDefined();
    expect(log.error).toHaveBeenCalledOnce();
  });
});

describe("notifyAvailable", () => {
  const rows = [
    row,
    { ...row, id: 8, request: "Post to Instagram from my shop" },
    { ...row, id: 9, email: "other@example.com", owner_id: "user:2" },
    { ...row, id: 10, email: null as unknown as string, owner_id: "key:3" },
    {
      ...row,
      id: 11,
      missing: [{ requirement: "Sync Google Calendar", why: "external platform" }],
    },
  ];

  it("one email per address for the matching rows, marked notified, subscription closed when nothing is pending", async () => {
    const { db, state, priority } = fakeDb(rows);
    const { mailer, sent } = mockMailer();
    const r = await notifyAvailable(
      db,
      mailer,
      { capability: "instagram" },
      { message: "Instagram publishing is in." },
    );
    expect(r).toMatchObject({ matched: 4, failed: 0, withoutEmail: [10] });
    expect(sent.map((s) => s.to[0]).sort()).toEqual(["other@example.com", "person@example.com"]);
    expect(sent.find((s) => s.to[0] === "person@example.com")?.text).toContain(
      "Post to Instagram from my shop",
    );
    expect(state.find((s) => s.id === 10)?.available_notified_at).toBeNull();
    // user:1 still has row 11 pending; user:2 has nothing left.
    expect(priority.has("user:1")).toBe(false);
    expect(priority.get("user:2")).toBeInstanceOf(Date);
    // Running it again emails nobody.
    expect((await notifyAvailable(db, mailer, { capability: "instagram" })).emailed).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it("by ids; a failed send leaves the rows pending", async () => {
    const { db, state } = fakeDb(rows);
    const { mailer } = mockMailer(500);
    const r = await notifyAvailable(db, mailer as Mailer, { ids: [11] });
    expect(r).toMatchObject({ matched: 1, emailed: [], failed: 1 });
    expect(state.find((s) => s.id === 11)?.available_notified_at).toBeNull();
  });

  it("parses the owner's command line", () => {
    expect(parseArgs(["--", "7,8", "9", "--send"])).toEqual({ ids: [7, 8, 9], send: true });
    expect(parseArgs(["--capability", "google calendar", "--message", "Now in."])).toEqual({
      ids: [],
      send: false,
      capability: "google calendar",
      message: "Now in.",
    });
    expect(() => parseArgs(["--all"])).toThrow(/unknown argument/);
  });
});

// The real SQL against Postgres (TEST_DATABASE_URL, e.g. a throwaway container); skipped without one.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("demand emails in Postgres", () => {
  let db: pg.Pool;
  beforeAll(async () => {
    const { default: pgm } = await import("pg");
    const { readFileSync } = await import("node:fs");
    db = new pgm.Pool({ connectionString: url });
    await db.query("DROP TABLE IF EXISTS use_case_demand, priority_notifications");
    // The demand tables without the builds foreign key (only they are needed here).
    const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
    await db.query(
      sql("0011_use_case_demand.sql").replace("REFERENCES builds (id) ON DELETE SET NULL", ""),
    );
    await db.query(sql("0013_demand_email.sql"));
    await db.query(
      `INSERT INTO use_case_demand (build_id, owner_id, email, request, status, use_case, missing) VALUES
       ('00000000-0000-0000-0000-000000000001', 'user:1', 'person@example.com', 'publish to instagram', 'uncovered', NULL,
        '[{"requirement":"Publish to Instagram","why":"external platform"}]'),
       ('00000000-0000-0000-0000-000000000002', 'user:1', NULL, 'calendar', 'partial', 'saas-crud',
        '[{"requirement":"Sync Google Calendar","why":"external platform"}]')`,
    );
    await db.query(
      `INSERT INTO priority_notifications (owner_id, email) VALUES ('user:1', 'person@example.com')`,
    );
  });
  afterAll(async () => {
    await db?.query("DROP TABLE IF EXISTS use_case_demand, priority_notifications");
    await db?.end();
  });

  it("claims once, falls back to the subscription email, and notifies by capability", async () => {
    const { mailer, sent } = mockMailer();
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";
    const [a, b] = await Promise.all([
      sendDemandEmails(db, mailer, id1),
      sendDemandEmails(db, mailer, id1),
    ]);
    expect([a.confirmation, b.confirmation].sort()).toEqual(["sent", "skipped"]);
    expect((await sendDemandEmails(db, mailer, id2)).confirmation).toBe("sent");
    expect(sent.filter((s) => s.to[0] === "person@example.com")).toHaveLength(2);
    const r = await notifyAvailable(db, mailer, { capability: "instagram" });
    expect(r).toMatchObject({ matched: 1, emailed: ["person@example.com"] });
    const p = await db.query(
      "SELECT notified_at FROM priority_notifications WHERE owner_id = 'user:1'",
    );
    expect(p.rows[0].notified_at).toBeNull();
    const r2 = await notifyAvailable(db, mailer, { capability: "saas-crud" });
    expect(r2.emailed).toEqual(["person@example.com"]);
    const p2 = await db.query(
      "SELECT notified_at FROM priority_notifications WHERE owner_id = 'user:1'",
    );
    expect(p2.rows[0].notified_at).not.toBeNull();
  });
});

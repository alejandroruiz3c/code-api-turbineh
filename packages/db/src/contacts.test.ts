import { resendMailer } from "@turbineh/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool } from "./client.js";
import {
  CONTACT_CHANGES_PER_DAY,
  DEMAND_EMAIL_UPDATES,
  demandContactStatus,
  deleteWorkspaceContact,
  getWorkspaceContact,
  isPrivateOwner,
  maskEmail,
  normalizeEmail,
  setDemandEmail,
  setWorkspaceContact,
} from "./contacts.js";
import { recordDemand } from "./demand.js";
import { listDemand } from "./demand.js";
import { MAX_EMAIL_ATTEMPTS, sendDemandEmails } from "./demand-email.js";
import { migrate } from "./migrate.js";
import { accountIdentities } from "./owner-report.js";

/** Workspace contact emails (ADR-0074): who can hold one, what is stored, what reaches the demand and the report. */

const WS = "invite:3f2b8c1e-5d4a-4e7b-9a10-2c3d4e5f6a7b";
const WS2 = "invite:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("contact rules", () => {
  it("only private workspaces (random ids), accounts and API keys can hold an email", () => {
    expect(isPrivateOwner(WS)).toBe(true);
    expect(isPrivateOwner("user:abc")).toBe(true);
    expect(isPrivateOwner("api:key-1")).toBe(true);
    expect(isPrivateOwner("invite:api-default")).toBe(false);
    expect(isPrivateOwner("invite:my-team-ws")).toBe(false);
  });

  it("normalises and validates addresses", () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
    for (const bad of ["", "person", "a@b", "a b@example.com", 'x"@example.com', 42, null])
      expect(normalizeEmail(bad)).toBeNull();
    expect(normalizeEmail(`${"x".repeat(250)}@example.com`)).toBeNull();
  });

  it("masks the address to the first letter and the domain", () => {
    expect(maskEmail("person@example.com")).toBe("p•••@example.com");
    expect(maskEmail("broken")).toBe("•••");
  });
});

/** A Resend mailer over a mocked fetch: records every message sent. */
function mockMailer() {
  const sent: { to: string[]; subject: string; key?: string }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as (typeof sent)[number];
    const key = (init.headers as Record<string, string>)["Idempotency-Key"];
    sent.push({ ...body, ...(key ? { key } : {}) });
    return Response.json({ id: `em_${sent.length}` });
  });
  return {
    mailer: resendMailer({ apiKey: "re_test", fetch: fetchMock as unknown as typeof fetch }),
    sent,
  };
}

// Against a real Postgres (TEST_DATABASE_URL): a fresh database with every migration. Skipped without one.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("workspace contacts in Postgres", () => {
  let admin: pg.Client;
  let db: pg.Pool;
  const name = `contacts_${process.pid}_${Date.now()}`;
  const B = (i: number) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
  const build = (i: number, owner: string) =>
    db.query(`INSERT INTO builds (id, prompt, status, owner_id) VALUES ($1, 'p', 'failed', $2)`, [
      B(i),
      owner,
    ]);
  const demand = (i: number, owner: string, email: string | null = null) =>
    recordDemand(db, {
      buildId: B(i),
      ownerId: owner,
      email,
      request: "A marketplace that pays sellers out automatically",
      status: "uncovered",
      useCase: null,
      missing: [{ requirement: "Automatic seller payouts", why: "no verified component yet" }],
    });
  const row = async (i: number) =>
    (
      await db.query<{ email: string | null; confirmation_attempts: number }>(
        "SELECT email, confirmation_attempts FROM use_case_demand WHERE build_id = $1",
        [B(i)],
      )
    ).rows[0];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(url ?? "");
    u.pathname = `/${name}`;
    await migrate(u.toString());
    await closePool();
    db = new pg.Pool({ connectionString: u.toString() });
  });
  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });

  it("an earlier refused request gets the email given later; new ones get it when recorded", async () => {
    await build(1, WS);
    await demand(1, WS);
    expect((await row(1))?.email).toBeNull();
    expect(await setWorkspaceContact(db, WS, " Person@Example.com ")).toBe("saved");
    expect(await getWorkspaceContact(db, WS)).toBe("person@example.com");
    expect((await row(1))?.email).toBe("person@example.com");
    const p = await db.query("SELECT email FROM priority_notifications WHERE owner_id = $1", [WS]);
    expect(p.rows[0].email).toBe("person@example.com");
    // A later refused request without contact_email on the flow: the workspace's email.
    await build(2, WS);
    await demand(2, WS);
    expect((await row(2))?.email).toBe("person@example.com");
    // An explicit notify_email on the flow wins.
    await build(3, WS);
    await demand(3, WS, "other@example.com");
    expect((await row(3))?.email).toBe("other@example.com");
    // Same address again: unchanged, not counted.
    expect(await setWorkspaceContact(db, WS, "person@example.com")).toBe("unchanged");
    // A new address replaces the old one where it was the workspace's, never an explicit one.
    expect(await setWorkspaceContact(db, WS, "new@example.com")).toBe("saved");
    expect((await row(1))?.email).toBe("new@example.com");
    expect((await row(3))?.email).toBe("other@example.com");
  });

  it("the owner report and the demand list show the workspace email (staff only)", async () => {
    const ids = await accountIdentities(db, [WS]);
    expect(ids.get(WS)).toMatchObject({ email: "new@example.com" });
    const list = await listDemand(db);
    expect(list.find((d) => d.build_id === B(2))?.email).toBe("new@example.com");
  });

  it("a shared workspace never holds an email, and its subscription never takes one", async () => {
    expect(await setWorkspaceContact(db, "invite:api-default", "x@example.com")).toBe(
      "shared_workspace",
    );
    expect(await getWorkspaceContact(db, "invite:api-default")).toBeNull();
    await build(4, "invite:api-default");
    await demand(4, "invite:api-default", "first@example.com");
    expect((await row(4))?.email).toBe("first@example.com");
    const p = await db.query(
      "SELECT email FROM priority_notifications WHERE owner_id = 'invite:api-default'",
    );
    // Otherwise the next person's request in that workspace would be confirmed to this address.
    expect(p.rows[0].email).toBeNull();
    await build(5, "invite:api-default");
    await demand(5, "invite:api-default");
    expect((await demandContactStatus(db, B(5), "invite:api-default")).emailOnFile).toBe(false);
  });

  it(`rate-limits changes to ${CONTACT_CHANGES_PER_DAY} a day`, async () => {
    for (let i = 0; i < CONTACT_CHANGES_PER_DAY; i++)
      expect(await setWorkspaceContact(db, WS2, `p${i}@example.com`)).toBe("saved");
    expect(await setWorkspaceContact(db, WS2, "late@example.com")).toBe("rate_limited");
    expect(await getWorkspaceContact(db, WS2)).toBe(`p${CONTACT_CHANGES_PER_DAY - 1}@example.com`);
    await db.query(
      "UPDATE workspace_contacts SET window_start = now() - interval '25 hours' WHERE owner_id = $1",
      [WS2],
    );
    expect(await setWorkspaceContact(db, WS2, "late@example.com")).toBe("saved");
    expect(await deleteWorkspaceContact(db, WS2)).toBe(true);
    expect(await getWorkspaceContact(db, WS2)).toBeNull();
  });

  it("notify me: an old refused request without email gets it and its confirmation, once", async () => {
    const owner = "invite:0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    await build(6, owner);
    await demand(6, owner);
    // Older than the confirmation window, and already given up for lack of an address (ADR-0056).
    await db.query(
      `UPDATE use_case_demand SET created_at = now() - interval '10 days', confirmation_attempts = $2
       WHERE build_id = $1`,
      [B(6), MAX_EMAIL_ATTEMPTS],
    );
    expect(await demandContactStatus(db, B(6), owner)).toEqual({
      demand: true,
      emailOnFile: false,
      confirmed: false,
    });
    // Someone else's flow id: nothing found, nothing written.
    expect(await setDemandEmail(db, B(6), WS, "intruder@example.com")).toEqual({
      status: "no_demand",
    });
    expect(await setDemandEmail(db, B(6), owner, "Late@Example.com")).toEqual({
      status: "saved",
      confirmationPending: true,
    });
    expect((await row(6))?.email).toBe("late@example.com");
    const { mailer, sent } = mockMailer();
    // The automatic path keeps its window; the explicit request does not.
    expect((await sendDemandEmails(db, mailer, B(6))).confirmation).toBe("skipped");
    const r = await sendDemandEmails(db, mailer, B(6), undefined, { anyAge: true });
    expect(r.confirmation).toBe("sent");
    expect(sent.filter((s) => s.to[0] === "late@example.com")).toHaveLength(1);
    expect(
      (await sendDemandEmails(db, mailer, B(6), undefined, { anyAge: true })).confirmation,
    ).toBe("skipped");
    expect(await demandContactStatus(db, B(6), owner)).toEqual({
      demand: true,
      emailOnFile: true,
      confirmed: true,
    });
    // After it was sent, a new address is stored but nothing is pending.
    expect(await setDemandEmail(db, B(6), owner, "again@example.com")).toEqual({
      status: "saved",
      confirmationPending: false,
    });
  });

  it(`a flow that was not refused has no demand; at most ${DEMAND_EMAIL_UPDATES} changes per flow`, async () => {
    await build(7, WS);
    expect(await setDemandEmail(db, B(7), WS, "a@example.com")).toEqual({ status: "no_demand" });
    await demand(7, WS);
    for (let i = 0; i < DEMAND_EMAIL_UPDATES; i++)
      expect((await setDemandEmail(db, B(7), WS, `n${i}@example.com`)).status).toBe("saved");
    expect(await setDemandEmail(db, B(7), WS, "z@example.com")).toEqual({
      status: "rate_limited",
    });
  });
});

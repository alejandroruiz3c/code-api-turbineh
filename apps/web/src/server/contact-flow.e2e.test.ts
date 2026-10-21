import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0074 end to end through the real route handlers and the real SQL (TEST_DATABASE_URL: a fresh database with every
 * migration; skipped without one): the access page's form stores the workspace email, plans of that workspace carry it,
 * the worker's demand record takes it, and "Notify me when it's covered" on a refused flow without one saves it and
 * emails the priority-list confirmation once. Only the browser (cookies, headers) and the email provider are simulated.
 */

const url = process.env.TEST_DATABASE_URL;
const name = `contact_flow_${process.pid}_${Date.now()}`;
const TOKEN = "invite-token-for-tests";
let pool: pg.Pool | null = null;

// The browser: one cookie jar, the request headers of the call in progress.
const jar = new Map<string, string>();
let reqHeaders = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => reqHeaders,
}));
const scheduled: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void scheduled.push(fn) }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({} as pg.Pool, {
    get: (_t, k: string) => {
      const v = Reflect.get(pool as pg.Pool, k) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(pool) : v;
    },
  }),
}));
vi.mock("@/server/env", () => ({
  env: {
    PRODUCT_ACCESS_TOKEN: "invite-token-for-tests",
    BETTER_AUTH_SECRET: "s".repeat(32),
    USER_DAILY_BUILDS: 50,
    IP_DAILY_BUILDS: 50,
    DAILY_COST_CAP_EUR: 100,
  },
}));
vi.mock("@/server/storage", () => ({ storage: { url: async (k: string) => `/files/${k}` } }));
vi.mock("@/server/github", () => ({
  workspaceGitHub: async () => ({ connected: false, gh: null }),
}));
vi.mock("@/server/plan-decider", () => ({ planDecider: () => null }));

const sent: { to: string[]; subject: string }[] = [];

describe.skipIf(!url)("contact email end to end (ADR-0074)", () => {
  let admin: pg.Client;
  let access: typeof import("@/app/api/access/route");
  let contact: typeof import("@/app/v1/contact/route");
  let notify: typeof import("@/app/v1/builds/[id]/notify/route");
  let plans: typeof import("@/app/v1/plans/route");
  let db: typeof import("@turbineh/db");

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(url ?? "");
    u.pathname = `/${name}`;
    db = await import("@turbineh/db");
    await db.migrate(u.toString());
    await db.closePool();
    pool = new pg.Pool({ connectionString: u.toString() });
    access = await import("@/app/api/access/route");
    contact = await import("@/app/v1/contact/route");
    notify = await import("@/app/v1/builds/[id]/notify/route");
    plans = await import("@/app/v1/plans/route");
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });
  beforeEach(() => {
    scheduled.length = 0;
    sent.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("DEMAND_ALERT_EMAIL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string) as (typeof sent)[number]);
        return Response.json({ id: `em_${sent.length}` });
      }),
    );
  });

  /** A browser request (cookie from the jar); `bearer` for an API caller instead. */
  const call = (path: string, init: RequestInit = {}, bearer?: string, workspace?: string) => {
    reqHeaders = new Headers({
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(workspace ? { "x-turbineh-workspace": workspace } : {}),
    });
    return new Request(`https://software.example${path}`, { headers: reqHeaders, ...init });
  };
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    reqHeaders = new Headers();
    return new Request("https://software.example/api/access", { method: "POST", body: f });
  };
  const ownerOfJar = () => `invite:${(jar.get("tbh_access") ?? "").split(".")[0]}`;
  const options = async (id: string) =>
    (await pool!.query("SELECT options FROM builds WHERE id = $1", [id])).rows[0].options as {
      contact_email?: string;
    };

  it("/access: the token and a valid email are both required; the email is stored for the workspace", async () => {
    jar.clear();
    const bad = await access.POST(
      form({ token: TOKEN, email: "not-an-email", next: "/flows/new" }),
    );
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe(
      "https://software.example/access?error=email&next=%2Fflows%2Fnew",
    );
    expect(jar.size).toBe(0);
    const wrong = await access.POST(form({ token: "nope", email: "person@example.com" }));
    expect(wrong.headers.get("location")).toContain("error=token");
    // Neither the token nor the email ever goes into the redirect URL.
    expect(wrong.headers.get("location")).not.toContain("person");

    const ok = await access.POST(
      form({ token: TOKEN, email: " Person@Example.com ", next: "/flows/new" }),
    );
    expect(ok.headers.get("location")).toBe("https://software.example/flows/new");
    expect(jar.has("tbh_access")).toBe(true);
    expect(await db.getWorkspaceContact(pool!, ownerOfJar())).toBe("person@example.com");
    const me = await contact.GET();
    expect(await me.json()).toMatchObject({
      email_on_file: true,
      email: "p•••@example.com",
      source: "workspace",
    });
  });

  it("plans of that workspace carry the email; the worker's demand record takes it", async () => {
    const res = await plans.POST(
      call("/v1/plans?wait=0", {
        method: "POST",
        body: JSON.stringify({ need: "A marketplace that pays sellers out automatically" }),
      }),
    );
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect((await options(id)).contact_email).toBe("person@example.com");
    // The worker records the refused request with the flow's contact email (apps/worker service.ts).
    await db.recordDemand(pool!, {
      buildId: id,
      ownerId: ownerOfJar(),
      email: (await options(id)).contact_email ?? null,
      request: "A marketplace that pays sellers out automatically",
      status: "uncovered",
      useCase: null,
      missing: [],
    });
    expect(await db.demandContactStatus(pool!, id, ownerOfJar())).toMatchObject({
      demand: true,
      emailOnFile: true,
    });
    const explicit = await plans.POST(
      call("/v1/plans?wait=0", {
        method: "POST",
        body: JSON.stringify({
          need: "Another uncovered request",
          notify_email: "Team@Example.com",
        }),
      }),
    );
    expect((await options(((await explicit.json()) as { id: string }).id)).contact_email).toBe(
      "team@example.com",
    );
    const invalid = await plans.POST(
      call("/v1/plans?wait=0", {
        method: "POST",
        body: JSON.stringify({ need: "Another uncovered request", notify_email: "nope" }),
      }),
    );
    expect(invalid.status).toBe(422);
  });

  it("a workspace without an email is asked once (banner) and can save it", async () => {
    jar.clear();
    // An older cookie (before the access page asked for an email): no contact stored.
    const ws = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
    const { signAccessCookie, cookieSecret } = await import("@/server/access-token");
    jar.set("tbh_access", await signAccessCookie(ws, cookieSecret(TOKEN, "s".repeat(32))));
    expect(await (await contact.GET()).json()).toMatchObject({
      email_on_file: false,
      shared_workspace: false,
    });
    const bad = await contact.PUT(
      call("/v1/contact", { method: "PUT", body: JSON.stringify({ email: "x" }) }),
    );
    expect(bad.status).toBe(422);
    const ok = await contact.PUT(
      call("/v1/contact", { method: "PUT", body: JSON.stringify({ email: "later@example.com" }) }),
    );
    expect(await ok.json()).toMatchObject({ email_on_file: true, email: "l•••@example.com" });
    expect(await db.getWorkspaceContact(pool!, `invite:${ws}`)).toBe("later@example.com");
  });

  it("the shared invitation workspace cannot hold an email", async () => {
    reqHeaders = new Headers({ authorization: `Bearer ${TOKEN}` });
    expect(await (await contact.GET()).json()).toMatchObject({
      email_on_file: false,
      shared_workspace: true,
    });
    const put = await contact.PUT(
      call(
        "/v1/contact",
        { method: "PUT", body: JSON.stringify({ email: "a@example.com" }) },
        TOKEN,
      ),
    );
    expect(put.status).toBe(403);
    expect(((await put.json()) as { code: string }).code).toBe("shared_workspace");
  });

  it("not covered → 'Notify me when it's covered' saves the email and sends the confirmation once", async () => {
    const owner = "invite:7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
    const { id } = await db.enqueueBuild(pool!, { prompt: "Uncovered request", ownerId: owner });
    // What the worker does for a refused request of a workspace without any email (ADR-0052).
    await db.recordDemand(pool!, {
      buildId: id,
      ownerId: owner,
      email: null,
      request: "Uncovered request",
      status: "uncovered",
      useCase: null,
      missing: [{ requirement: "Automatic seller payouts", why: "no verified component yet" }],
    });
    const ws = owner.slice("invite:".length);
    const asOwner = (init: RequestInit = {}) => call(`/v1/builds/${id}/notify`, init, TOKEN, ws);
    const ctx = { params: Promise.resolve({ id }) };

    expect(await (await notify.GET(asOwner(), ctx)).json()).toMatchObject({
      demand: true,
      email_on_file: false,
      confirmed: false,
    });
    // Another workspace never sees nor changes it.
    const other = await notify.POST(
      call(
        `/v1/builds/${id}/notify`,
        { method: "POST", body: JSON.stringify({ email: "intruder@example.com" }) },
        TOKEN,
        "11111111-2222-4333-8444-555555555555",
      ),
      ctx,
    );
    expect(other.status).toBe(404);
    const invalid = await notify.POST(
      asOwner({ method: "POST", body: JSON.stringify({ email: "nope" }) }),
      ctx,
    );
    expect(invalid.status).toBe(422);

    const ok = await notify.POST(
      asOwner({ method: "POST", body: JSON.stringify({ email: "Asker@Example.com" }) }),
      ctx,
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toEqual({ demand: true, email_on_file: true, confirmation: "scheduled" });
    // The response never carries the address.
    expect(JSON.stringify(body)).not.toContain("asker");
    expect(sent).toHaveLength(0);
    for (const fn of scheduled.splice(0)) await fn();
    expect(sent.map((s) => s.to[0])).toContain("asker@example.com");
    expect(sent.find((s) => s.to[0] === "asker@example.com")?.subject).toBe(
      "You're on the TurbineH priority list",
    );
    expect(await (await notify.GET(asOwner(), ctx)).json()).toMatchObject({
      email_on_file: true,
      confirmed: true,
    });
    // Again: stored, but the confirmation is not sent twice.
    const again = await notify.POST(
      asOwner({ method: "POST", body: JSON.stringify({ email: "asker@example.com" }) }),
      ctx,
    );
    expect(((await again.json()) as { confirmation: string }).confirmation).toBe("already_sent");
    // A flow that was not refused has nothing to follow up.
    const { id: fine } = await db.enqueueBuild(pool!, { prompt: "Covered", ownerId: owner });
    const notRefused = await notify.POST(
      call(
        `/v1/builds/${fine}/notify`,
        { method: "POST", body: JSON.stringify({ email: "a@example.com" }) },
        TOKEN,
        ws,
      ),
      { params: Promise.resolve({ id: fine }) },
    );
    expect(notRefused.status).toBe(409);
    // Staff see it in the demand list.
    expect((await db.listDemand(pool!)).find((d) => d.build_id === id)?.email).toBe(
      "asker@example.com",
    );
  });
});

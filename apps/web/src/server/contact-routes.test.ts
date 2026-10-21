import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0074 route logic without a database (the SQL is proved in packages/db/src/contacts.test.ts and end to end in
 * contact-flow.e2e.test.ts): what the access form stores, which contact email new flows carry, and how
 * POST /v1/builds/{id}/notify answers.
 */

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
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/env", () => ({
  env: {
    PRODUCT_ACCESS_TOKEN: "invite-token-for-tests",
    BETTER_AUTH_SECRET: "s".repeat(32),
    USER_DAILY_BUILDS: 50,
    IP_DAILY_BUILDS: 50,
    DAILY_COST_CAP_EUR: 100,
  },
}));

const contacts = new Map<string, string>();
const enqueued: { ownerId: string; options: Record<string, unknown> }[] = [];
let demandResult: { status: string; confirmationPending?: boolean } = { status: "no_demand" };
const sendDemandEmails = vi.fn(async () => ({ confirmation: "sent", ownerAlert: "skipped" }));
vi.mock("@turbineh/db", async (orig) => {
  const real = await orig<typeof import("@turbineh/db")>();
  return {
    ...real,
    setWorkspaceContact: vi.fn(async (_db: unknown, owner: string, email: string) => {
      contacts.set(owner, real.normalizeEmail(email) as string);
      return "saved";
    }),
    getWorkspaceContact: async (_db: unknown, owner: string) => contacts.get(owner) ?? null,
    buildsLastDay: async () => 0,
    buildsLastDayFromIp: async () => 0,
    costToday: async () => ({ eur: 0 }),
    enqueueBuild: async (_db: unknown, input: (typeof enqueued)[number]) => {
      enqueued.push(input);
      return { id: "00000000-0000-4000-8000-000000000001", created: true };
    },
    getBuild: async (_db: unknown, id: string, owner: string) =>
      owner === "api:mine" ? { id, owner_id: owner } : null,
    setDemandEmail: async () => demandResult,
    sendDemandEmails,
  };
});
vi.mock("@/server/caller", async (orig) => {
  const real = await orig<typeof import("@/server/caller")>();
  return {
    ...real,
    getCaller: async () =>
      reqHeaders.get("authorization") === "Bearer tbh_key"
        ? { kind: "api-key", ownerId: "api:mine", apiKeyId: "k", dailyQuota: 50 }
        : real.getCaller(),
  };
});

const access = await import("@/app/api/access/route");
const builds = await import("@/app/v1/builds/route");
const notify = await import("@/app/v1/builds/[id]/notify/route");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  reqHeaders = new Headers();
  return new Request("https://software.example/api/access", { method: "POST", body: f });
};
const apiPost = (path: string, body: unknown) => {
  reqHeaders = new Headers({ authorization: "Bearer tbh_key", "content-type": "application/json" });
  return new Request(`https://software.example${path}`, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify(body),
  });
};
const PROMPT = "An online marketplace that pays sellers out automatically every week";

beforeEach(() => {
  jar.clear();
  contacts.clear();
  enqueued.length = 0;
  scheduled.length = 0;
  sendDemandEmails.mockClear();
  vi.unstubAllEnvs();
});

describe("POST /api/access (ADR-0074)", () => {
  it("refuses a missing or invalid email without letting the person in", async () => {
    for (const email of ["", "person", "a@b", "two words@example.com"]) {
      const r = await access.POST(form({ token: "invite-token-for-tests", email }));
      expect(r.headers.get("location")).toBe(
        "https://software.example/access?error=email&next=%2F",
      );
    }
    expect(jar.size).toBe(0);
    expect(contacts.size).toBe(0);
  });

  it("checks the token first and keeps both out of the URL", async () => {
    const r = await access.POST(form({ token: "wrong", email: "person@example.com" }));
    expect(r.headers.get("location")).toBe("https://software.example/access?error=token&next=%2F");
  });

  it("lets the person in and stores the email for the new workspace", async () => {
    const r = await access.POST(
      form({ token: "invite-token-for-tests", email: "Person@Example.com", next: "/catalog" }),
    );
    expect(r.headers.get("location")).toBe("https://software.example/catalog");
    const ws = (jar.get("tbh_access") ?? "").split(".")[0];
    expect(contacts.get(`invite:${ws}`)).toBe("person@example.com");
  });
});

describe("contact email of new flows", () => {
  it("POST /v1/builds: notify_email wins, else the workspace's; never injectable through options", async () => {
    await builds.POST(apiPost("/v1/builds", { prompt: PROMPT, notify_email: "Asker@Example.com" }));
    expect(enqueued[0]?.options.contact_email).toBe("asker@example.com");
    contacts.set("api:mine", "team@example.com");
    await builds.POST(
      apiPost("/v1/builds", { prompt: PROMPT, options: { contact_email: "x@evil.example" } }),
    );
    expect(enqueued[1]?.options.contact_email).toBe("team@example.com");
    contacts.clear();
    await builds.POST(apiPost("/v1/builds", { prompt: PROMPT }));
    expect(enqueued[2]?.options).not.toHaveProperty("contact_email");
    const bad = await builds.POST(apiPost("/v1/builds", { prompt: PROMPT, notify_email: "nope" }));
    expect(bad.status).toBe(422);
    expect(enqueued).toHaveLength(3);
  });
});

describe("POST /v1/builds/{id}/notify", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  const ctx = { params: Promise.resolve({ id }) };
  const send = (email: string) => notify.POST(apiPost(`/v1/builds/${id}/notify`, { email }), ctx);

  it("401 without a valid caller, 404 for an id that is not one of the caller's flows, 422 for an invalid address", async () => {
    reqHeaders = new Headers({ authorization: "Bearer someone-else" });
    const other = await notify.POST(
      new Request(`https://software.example/v1/builds/${id}/notify`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ email: "a@example.com" }),
      }),
      ctx,
    );
    expect(other.status).toBe(401);
    const notMine = await notify.POST(apiPost("/v1/builds/x/notify", { email: "a@example.com" }), {
      params: Promise.resolve({ id: "not-a-flow" }),
    });
    expect(notMine.status).toBe(404);
    expect((await send("not-an-email")).status).toBe(422);
  });

  it("409 when the flow was not refused, 429 past the limit", async () => {
    demandResult = { status: "no_demand" };
    const r = await send("a@example.com");
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("not_uncovered");
    demandResult = { status: "rate_limited" };
    expect((await send("a@example.com")).status).toBe(429);
  });

  it("schedules the confirmation only when it was not sent yet, and only with email configured", async () => {
    demandResult = { status: "saved", confirmationPending: true };
    expect(await (await send("a@example.com")).json()).toEqual({
      demand: true,
      email_on_file: true,
      confirmation: "email_disabled",
    });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(
      ((await (await send("a@example.com")).json()) as { confirmation: string }).confirmation,
    ).toBe("scheduled");
    for (const fn of scheduled.splice(0)) await fn();
    expect(sendDemandEmails).toHaveBeenCalledWith({}, expect.anything(), id, expect.anything(), {
      anyAge: true,
    });
    demandResult = { status: "saved", confirmationPending: false };
    expect(
      ((await (await send("a@example.com")).json()) as { confirmation: string }).confirmation,
    ).toBe("already_sent");
  });
});

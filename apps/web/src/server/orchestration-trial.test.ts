import type { TrialSignupInput } from "@turbineh/db";
import { describe, expect, it } from "vitest";
import {
  connection,
  handleTrialSignup,
  secretMatches,
  signupIpHash,
  type TrialSignupDeps,
} from "./orchestration-trial";

const SECRET = "not-a-real-secret-".repeat(3);

function deps(over: Partial<TrialSignupDeps> = {}, recent = { byOwner: 0, byIp: 0, total: 0 }) {
  const provisioned: TrialSignupInput[] = [];
  const seenRecent: { ownerId: string; ipHash: string | null }[] = [];
  const d: TrialSignupDeps = {
    secret: SECRET,
    baseUrl: "https://software.example.test/",
    trialUsd: 2,
    limits: { perEmail: 3, perIp: 10, total: 200 },
    ipHash: signupIpHash("k"),
    ownerIdOf: (email) => `trial:${email}`,
    recent: async (input) => {
      seenRecent.push(input);
      return recent;
    },
    provision: async (input) => {
      provisioned.push(input);
      return {
        ownerId: `trial:${input.email}`,
        token: "tbh_ai_new",
        prefix: "tbh_ai_new",
        existing: provisioned.length > 1,
      };
    },
    spent: async () => 0.75,
    tokenDefaults: { dailyTokenQuota: 2_000_000, requestsPerMinute: 60 },
    ...over,
  };
  return { d, provisioned, seenRecent };
}

const post = (body: unknown, secret: string | null = SECRET) =>
  new Request("https://software.example.test/v1/ai/trial-signups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const person = {
  email: "  Ada.Lovelace@Example.COM ",
  name: "Ada",
  company: "Analytical",
  useCase: "Routing support tickets",
  clientIp: "203.0.113.7",
};

describe("POST /v1/ai/trial-signups (ADR-0059)", () => {
  it("does not exist without the secret; a wrong or missing bearer is 401", async () => {
    for (const secret of [undefined, "", "  "])
      expect((await handleTrialSignup(post(person), deps({ secret }).d)).status).toBe(404);
    const { d, provisioned } = deps();
    for (const s of [null, "nope", `${SECRET}x`, SECRET.slice(0, -1)])
      expect((await handleTrialSignup(post(person, s), d)).status).toBe(401);
    expect(provisioned).toHaveLength(0);
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches("", "")).toBe(false);
  });

  it("201 with the connection data; the email is lowercased and the IP only hashed", async () => {
    const { d, provisioned, seenRecent } = deps();
    const res = await handleTrialSignup(post(person), d);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      token: "tbh_ai_new",
      prefix: "tbh_ai_new",
      apiBase: "https://software.example.test/v1/ai/v1",
      mcpUrl: "https://software.example.test/v1/ai/mcp",
      trialUsd: 2,
      remainingUsd: 2,
      existing: false,
      contact: "alex.ruiz@turbineh.com",
    });
    expect(provisioned[0]).toMatchObject({
      email: "ada.lovelace@example.com",
      name: "Ada",
      company: "Analytical",
      useCase: "Routing support tickets",
      dailyTokenQuota: 2_000_000,
      requestsPerMinute: 60,
    });
    expect(provisioned[0]?.ipHash).toBe(signupIpHash("k")("203.0.113.7"));
    expect(JSON.stringify(provisioned)).not.toContain("203.0.113.7");
    expect(seenRecent[0]?.ownerId).toBe("trial:ada.lovelace@example.com");
  });

  it("a repeat signup reuses the account: new token, same balance", async () => {
    const { d } = deps();
    await handleTrialSignup(post(person), d);
    const again = (await (await handleTrialSignup(post(person), d)).json()) as {
      existing: boolean;
      remainingUsd: number;
    };
    expect(again.existing).toBe(true);
    expect(again.remainingUsd).toBeCloseTo(1.25);
  });

  it("validates the body with sane limits; optional fields may be empty", async () => {
    const { d, provisioned } = deps();
    for (const body of [
      "not json",
      {},
      { ...person, email: "not-an-email" },
      { ...person, name: "" },
      { ...person, name: "x".repeat(121) },
      { ...person, useCase: "x".repeat(2001) },
      { ...person, clientIp: "999.1.1.1" },
    ]) {
      const res = await handleTrialSignup(post(body), d);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("invalid_request");
    }
    expect(provisioned).toHaveLength(0);
    const ok = await handleTrialSignup(
      post({ email: "a@b.co", name: "A", company: "", useCase: " " }),
      d,
    );
    expect(ok.status).toBe(201);
    expect(provisioned[0]).toMatchObject({ company: null, useCase: null, ipHash: null });
  });

  it("rate limits per email, per client IP and per day", async () => {
    const limited = async (
      recent: { byOwner: number; byIp: number; total: number },
      body = person,
    ) => {
      const { d, provisioned } = deps({}, recent);
      const res = await handleTrialSignup(post(body), d);
      return { status: res.status, provisioned: provisioned.length };
    };
    expect(await limited({ byOwner: 3, byIp: 0, total: 3 })).toEqual({
      status: 429,
      provisioned: 0,
    });
    expect(await limited({ byOwner: 0, byIp: 10, total: 10 })).toEqual({
      status: 429,
      provisioned: 0,
    });
    expect(await limited({ byOwner: 0, byIp: 0, total: 200 })).toEqual({
      status: 429,
      provisioned: 0,
    });
    // Without a forwarded client IP there is no per-IP limit (the caller is the landing server).
    const noIp: Partial<typeof person> = { ...person };
    delete noIp.clientIp;
    expect(await limited({ byOwner: 0, byIp: 99, total: 5 }, noIp as typeof person)).toEqual({
      status: 201,
      provisioned: 1,
    });
  });

  it("connection URLs", () => {
    expect(connection("https://software.turbineh.com")).toEqual({
      apiBase: "https://software.turbineh.com/v1/ai/v1",
      mcpUrl: "https://software.turbineh.com/v1/ai/mcp",
    });
  });
});

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";
import { ACCESS_COOKIE, cookieSecret, signAccessCookie } from "./server/access-token";

const TOKEN = "proxy-test-invitation-token";
const AUTH = "proxy-test-auth-secret";

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://software.example.test"), { headers });

/** NextResponse.next() carries this header; redirects and 401s do not. */
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("proxy (ADR-0030 gate)", () => {
  beforeEach(() => {
    process.env.PRODUCT_ACCESS_TOKEN = TOKEN;
    process.env.BETTER_AUTH_SECRET = AUTH;
  });
  afterEach(() => {
    delete process.env.PRODUCT_ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("serves /use without the invitation (it explains how to get in)", async () => {
    expect(passes(await proxy(req("/use")))).toBe(true);
  });

  it("keeps the allow-list exact: neighbours of /use stay gated", async () => {
    for (const p of ["/user", "/use/x", "/uses", "/flows/new", "/catalog", "/"]) {
      const r = await proxy(req(p));
      expect(r.status, p).toBe(307);
      expect(new URL(r.headers.get("location") ?? "").pathname, p).toBe("/access");
    }
  });

  it("lets the cookie through to gated pages", async () => {
    const cookie = await signAccessCookie(
      "3f1c2a4e-0000-4000-8000-1234567890ab",
      cookieSecret(TOKEN, AUTH),
    );
    expect(passes(await proxy(req("/flows/new", { cookie: `${ACCESS_COOKIE}=${cookie}` })))).toBe(
      true,
    );
  });

  describe("catalogue index for agents", () => {
    for (const p of ["/catalog/index.json", "/catalog/llms.txt"]) {
      it(`${p}: the invitation token as Bearer is enough`, async () => {
        expect(passes(await proxy(req(p, { authorization: `Bearer ${TOKEN}` })))).toBe(true);
      });

      it(`${p}: a wrong or malformed Bearer is a 401 problem, not a redirect`, async () => {
        for (const authorization of ["Bearer nope", `Basic ${TOKEN}`, "Bearer "]) {
          const r = await proxy(req(p, { authorization }));
          expect(r.status).toBe(401);
          expect(r.headers.get("content-type")).toContain("application/problem+json");
          expect(((await r.json()) as { code: string }).code).toBe("unauthorized");
        }
      });

      it(`${p}: no credentials → 401 for API callers, /access for browsers`, async () => {
        expect((await proxy(req(p, { accept: "*/*" }))).status).toBe(401);
        const browser = await proxy(req(p, { accept: "text/html,application/xhtml+xml" }));
        expect(browser.status).toBe(307);
      });
    }

    it("never accepts a Bearer when no token is configured", async () => {
      delete process.env.PRODUCT_ACCESS_TOKEN;
      expect((await proxy(req("/catalog/index.json", { authorization: "Bearer " }))).status).toBe(
        401,
      );
    });

    it("the Bearer opens only the index files, not the catalogue pages", async () => {
      const r = await proxy(req("/catalog", { authorization: `Bearer ${TOKEN}` }));
      expect(r.status).toBe(307);
    });
  });

  it("the orchestration API, its MCP server and trial signups are outside the gate (own Bearer auth, ADR-0059)", () => {
    const matcher = new RegExp(`^${config.matcher[0] ?? ""}$`);
    for (const p of [
      "/v1/ai/mcp",
      "/v1/ai/trial-signups",
      "/v1/ai/v1/chat/completions",
      "/v1/ai/v1/usage",
    ])
      expect(matcher.test(p), p).toBe(false);
    expect(matcher.test("/flows/new")).toBe(true);
  });
});

describe("v1Guard (audit I-6, I-7)", () => {
  const api = (path: string, method: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL(path, "https://software.example.test"), { method, headers });

  it("rejects malformed x-turbineh-workspace values with a 400 problem", async () => {
    for (const ws of ["default", "../../etc", "<script>", "x".repeat(5000)]) {
      const r = await proxy(api("/v1/activity", "GET", { "x-turbineh-workspace": ws }));
      expect(r.status, ws).toBe(400);
      expect((await r.json()).code).toBe("invalid_workspace");
    }
    expect(passes(await proxy(api("/v1/activity", "GET", { "x-turbineh-workspace": crypto.randomUUID() })))).toBe(true);
  });

  it("requires application/json on cookie-authenticated writes (CSRF)", async () => {
    const r = await proxy(api("/v1/plans", "POST", { "content-type": "text/plain" }));
    expect(r.status).toBe(415);
    expect((await proxy(api("/v1/builds/x/ai-token", "POST"))).status).toBe(415);
    expect(passes(await proxy(api("/v1/plans", "POST", { "content-type": "application/json; charset=utf-8" })))).toBe(true);
    expect(passes(await proxy(api("/v1/plans", "POST", { authorization: "Bearer t", "content-type": "text/plain" })))).toBe(true);
    expect(passes(await proxy(api("/v1/plans", "GET")))).toBe(true);
    expect(passes(await proxy(api("/v1/ops/owner-report/send", "POST", { "content-type": "application/x-www-form-urlencoded" })))).toBe(true);
  });
});

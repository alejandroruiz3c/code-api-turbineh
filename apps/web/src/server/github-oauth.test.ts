import { createHash, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@turbineh/shared";
import { describe, expect, it } from "vitest";
import {
  connectionView,
  finishOAuth,
  safeReturn,
  scopesFor,
  sha256,
  startOAuth,
  type OAuthDeps,
} from "./github-oauth";

const KEY = randomBytes(32).toString("base64");
const TOKEN = "gho_example_token_value_0123456789abcdef";

/** In-memory OAuth wiring: a fake GitHub that records what it receives. */
function harness() {
  const states = new Map<string, Parameters<OAuthDeps["saveState"]>[0]>();
  const saved: Parameters<OAuthDeps["saveConnection"]>[0][] = [];
  const exchanges: Record<string, unknown>[] = [];
  const deps: OAuthDeps = {
    clientId: "Ov23client",
    clientSecret: "client-secret",
    redirectUri: "https://app.example/api/auth/callback/github/workspace",
    seal: (p) => encrypt(p, KEY),
    open: (s) => decrypt(s, KEY),
    saveState: async (s) => void states.set(s.stateHash, s),
    takeState: async (h) => {
      const s = states.get(h);
      states.delete(h);
      return s ?? null;
    },
    saveConnection: async (c) => void saved.push(c),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/login/oauth/access_token")) {
        exchanges.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ access_token: TOKEN, scope: "public_repo" });
      }
      return Response.json({ login: "octo" }, { headers: { "x-oauth-scopes": "public_repo" } });
    }) as typeof fetch,
  };
  return { deps, states, saved, exchanges };
}

const start = (
  h: ReturnType<typeof harness>,
  over: Partial<Parameters<typeof startOAuth>[1]> = {},
) =>
  startOAuth(h.deps, {
    ownerId: "invite:ws-a",
    privateRepos: false,
    returnTo: "/flows/new",
    viaTicket: false,
    ...over,
  });

describe("Connect GitHub (OAuth for the access workspace)", () => {
  it("authorize URL: minimal scope, state, PKCE S256; only the state hash and an encrypted verifier are stored", async () => {
    const h = harness();
    const { url, state } = await start(h);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("public_repo");
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(h.deps.redirectUri);
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect([...h.states.keys()]).toEqual([sha256(state)]);
    const row = [...h.states.values()][0];
    expect(JSON.stringify(row)).not.toContain(state);
    const verifier = h.deps.open(row?.verifierEnc ?? "");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      u.searchParams.get("code_challenge"),
    );
    expect(scopesFor(true)).toBe("repo");
  });

  it("rejects a callback whose state does not match the httpOnly cookie (login CSRF)", async () => {
    const h = harness();
    const { state } = await start(h);
    const base = { code: "c", error: null, callerOwnerId: "invite:ws-a" };
    expect(await finishOAuth(h.deps, { ...base, state, cookieState: undefined })).toMatchObject({
      ok: false,
      reason: "invalid_state",
    });
    expect(await finishOAuth(h.deps, { ...base, state, cookieState: `${state}x` })).toMatchObject({
      ok: false,
      reason: "invalid_state",
    });
    expect(h.saved).toEqual([]);
  });

  it("is single use and stores the token encrypted; the public view never has it", async () => {
    const h = harness();
    const { state } = await start(h);
    const input = {
      state,
      cookieState: state,
      code: "the-code",
      error: null,
      callerOwnerId: "invite:ws-a",
    };
    const r = await finishOAuth(h.deps, input);
    expect(r).toMatchObject({
      ok: true,
      ownerId: "invite:ws-a",
      login: "octo",
      privateRepos: false,
    });
    // PKCE verifier and the exact redirect URI are sent in the server-side exchange.
    expect(h.exchanges[0]).toMatchObject({ code: "the-code", redirect_uri: h.deps.redirectUri });
    expect(typeof h.exchanges[0]?.code_verifier).toBe("string");
    expect(h.saved[0]?.tokenEnc).not.toContain(TOKEN);
    expect(decrypt(h.saved[0]?.tokenEnc ?? "", KEY)).toBe(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    const view = connectionView({
      login: "octo",
      scopes: "public_repo",
      privateRepos: false,
      via: "oauth",
      connectedAt: "2026-10-12",
    });
    expect(JSON.stringify(view)).not.toMatch(/gho_|token_enc|tokenEnc/);
    // Replay of the same state finds nothing.
    expect(await finishOAuth(h.deps, input)).toMatchObject({ ok: false, reason: "invalid_state" });
  });

  it("binds the connection to the workspace that started it (CLI tickets are bound by the ticket)", async () => {
    const h = harness();
    const { state } = await start(h);
    expect(
      await finishOAuth(h.deps, {
        state,
        cookieState: state,
        code: "c",
        error: null,
        callerOwnerId: "invite:ws-b",
      }),
    ).toMatchObject({ ok: false, reason: "wrong_workspace" });
    expect(h.saved).toEqual([]);
    const t = await start(h, { ownerId: "invite:cli-ws", viaTicket: true });
    const r = await finishOAuth(h.deps, {
      state: t.state,
      cookieState: t.state,
      code: "c",
      error: null,
      callerOwnerId: null,
    });
    expect(r).toMatchObject({ ok: true, ownerId: "invite:cli-ws", viaTicket: true });
  });

  it("cancellation and failed exchanges store nothing", async () => {
    const h = harness();
    const a = await start(h);
    expect(
      await finishOAuth(h.deps, {
        state: a.state,
        cookieState: a.state,
        code: null,
        error: "access_denied",
        callerOwnerId: "invite:ws-a",
      }),
    ).toMatchObject({ ok: false, reason: "cancelled" });
    const b = await start(h);
    h.deps.fetch = (async () => Response.json({ error: "bad_verification_code" })) as typeof fetch;
    expect(
      await finishOAuth(h.deps, {
        state: b.state,
        cookieState: b.state,
        code: "x",
        error: null,
        callerOwnerId: "invite:ws-a",
      }),
    ).toMatchObject({ ok: false, reason: "exchange_failed" });
    expect(h.saved).toEqual([]);
  });

  it("return paths stay on this site", () => {
    expect(safeReturn("/flows/abc?x=1")).toBe("/flows/abc?x=1");
    expect(safeReturn("//evil.example")).toBe("/flows/new");
    expect(safeReturn("https://evil.example")).toBe("/flows/new");
    expect(safeReturn("/\\evil")).toBe("/flows/new");
  });
});

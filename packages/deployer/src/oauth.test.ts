import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeNeonCode,
  exchangeVercelCode,
  neonAuthorizeUrl,
  pkce,
  randomState,
  vercelInstallUrl,
} from "./oauth.js";

afterEach(() => vi.unstubAllGlobals());

describe("deploy sign-in (ADR-0021)", () => {
  it("builds the Vercel external install URL with state and rejects odd slugs", () => {
    const state = randomState();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(vercelInstallUrl("turbineh-deploy", state)).toBe(
      `https://vercel.com/integrations/turbineh-deploy/new?state=${state}`,
    );
    expect(() => vercelInstallUrl("../evil", state)).toThrow();
  });

  it("uses PKCE S256 and only the Neon scopes it needs", () => {
    const { verifier, challenge } = pkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const u = new URL(
      neonAuthorizeUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s", challenge }),
    );
    expect(u.origin).toBe("https://oauth2.neon.tech");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe(
      "openid urn:neoncloud:projects:create urn:neoncloud:projects:read",
    );
  });

  it("exchanges the Vercel code server-side and keeps team and installation", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "tok", team_id: "team_1", installation_id: "icfg_1" }),
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const r = await exchangeVercelCode({
      clientId: "oac_1",
      clientSecret: "s",
      code: "c",
      redirectUri: "https://x/cb",
    });
    expect(r).toEqual({ token: "tok", teamId: "team_1", configurationId: "icfg_1" });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.vercel.com/v2/oauth/access_token");
    expect(String(init.body)).toContain("redirect_uri=https%3A%2F%2Fx%2Fcb");
  });

  it("never repeats provider secrets in errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"invalid_grant token neon_abcdefghijklmnopqrstuvwxyz0123"}', {
            status: 400,
          }),
      ),
    );
    await expect(
      exchangeNeonCode({
        clientId: "c",
        clientSecret: "s",
        code: "x",
        redirectUri: "https://x/cb",
        verifier: "v",
      }),
    ).rejects.toThrow(/^Neon 400/);
    await expect(
      exchangeNeonCode({
        clientId: "c",
        clientSecret: "s",
        code: "x",
        redirectUri: "https://x/cb",
        verifier: "v",
      }),
    ).rejects.not.toThrow(/abcdefghijklmnop/);
  });
});

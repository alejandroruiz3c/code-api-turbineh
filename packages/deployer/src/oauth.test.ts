import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeVercelCode, randomState, vercelInstallUrl } from "./oauth.js";

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
          new Response('{"error":"invalid_grant token vercel_abcdefghijklmnopqrstuvwxyz0123"}', {
            status: 400,
          }),
      ),
    );
    const call = () =>
      exchangeVercelCode({
        clientId: "c",
        clientSecret: "s",
        code: "x",
        redirectUri: "https://x/cb",
      });
    await expect(call()).rejects.toThrow(/^Vercel 400/);
    await expect(call()).rejects.not.toThrow(/abcdefghijklmnop/);
  });
});

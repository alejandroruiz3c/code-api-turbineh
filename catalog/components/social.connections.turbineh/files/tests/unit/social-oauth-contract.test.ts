import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMock } from "../e2e/mocks/social/common";
import { linkedinMock } from "../e2e/mocks/social/linkedin";
import { metaMock } from "../e2e/mocks/social/meta";
import { xMock } from "../e2e/mocks/social/x";
import { graph } from "@/social/graph";
import { ProviderError } from "@/social/http";
import {
  accountsFor,
  authorizeUrl,
  exchangeCode,
  pkcePair,
  refreshTokens,
  revokeGrant,
} from "@/social/oauth";

/**
 * Contract tests of the OAuth flows (social.connections.turbineh) against local mocks of LinkedIn, Meta and X that
 * reproduce the request and response shapes of each provider's documentation (tests/e2e/mocks/social/*). The mocks
 * refuse anything the real endpoint would refuse: wrong client secret, redirect URI or PKCE verifier, missing scopes.
 */
const servers: Server[] = [];
const env: Record<string, string> = {
  APP_URL: "https://app.example.com",
  LINKEDIN_CLIENT_ID: "li-id",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  META_APP_ID: "meta-id",
  META_APP_SECRET: "meta-secret",
  X_CLIENT_ID: "x-id",
  X_CLIENT_SECRET: "x-secret",
};

async function serve(name: string, handler: Parameters<typeof startMock>[0], vars: string[]) {
  const server = await startMock(handler, 0);
  servers.push(server);
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const v of vars) env[v] = origin;
  return name;
}

beforeAll(async () => {
  await serve("linkedin", linkedinMock({ clientId: "li-id", clientSecret: "li-secret" }), [
    "LINKEDIN_API_BASE",
    "LINKEDIN_AUTH_BASE_URL",
  ]);
  await serve("meta", metaMock({ appId: "meta-id", appSecret: "meta-secret" }), [
    "META_GRAPH_API_BASE",
    "META_AUTH_BASE_URL",
  ]);
  await serve("x", xMock({ clientId: "x-id", clientSecret: "x-secret" }), [
    "X_API_BASE",
    "X_AUTH_BASE_URL",
  ]);
});
afterAll(() => {
  for (const s of servers) s.close();
});

/** Opens the consent page and follows "Allow": the code the provider sends back to the redirect URI. */
async function consent(url: string): Promise<{ code: string; state: string; redirect: string }> {
  const html = await (await fetch(url)).text();
  const href = /id="allow" href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  if (!href) throw new Error(`no consent link: ${html.slice(0, 200)}`);
  const back = new URL(href);
  return {
    code: back.searchParams.get("code") ?? "",
    state: back.searchParams.get("state") ?? "",
    redirect: `${back.origin}${back.pathname}`,
  };
}

describe("LinkedIn OAuth contract", () => {
  it("LinkedIn: authorization code → access token (60 days) → the member from /v2/userinfo; refresh refused without programmatic refresh; no revocation API", async () => {
    const c = await consent(authorizeUrl("linkedin", { state: "st-li" }, env));
    expect(c.state).toBe("st-li");
    expect(c.redirect).toBe("https://app.example.com/api/social/oauth/linkedin/callback");
    const tokens = await exchangeCode("linkedin", { code: c.code }, env);
    expect(tokens.expiresIn).toBe(5184000);
    expect(tokens.refreshToken).toBeNull();
    // A code is single use.
    await expect(exchangeCode("linkedin", { code: c.code }, env)).rejects.toBeInstanceOf(
      ProviderError,
    );
    const [account] = await accountsFor("linkedin", tokens, env);
    expect(account).toMatchObject({
      network: "linkedin",
      accountId: "li-member-1",
      accountName: "Ada Lovelace",
    });
    expect(account?.accessExpiresAt).toBeInstanceOf(Date);
    const refused = await refreshTokens("linkedin", "anything", env).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ProviderError);
    expect((refused as ProviderError).retryable).toBe(false);
    expect(
      await revokeGrant(
        "linkedin",
        {
          accessToken: tokens.accessToken,
          refreshToken: null,
          grantToken: null,
          grantSubject: "li-member-1",
        },
        env,
      ),
    ).toBe("local");
  });

  it("LinkedIn refuses a wrong client secret", async () => {
    const c = await consent(authorizeUrl("linkedin", { state: "st" }, env));
    await expect(
      exchangeCode("linkedin", { code: c.code }, { ...env, LINKEDIN_CLIENT_SECRET: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("Meta OAuth contract", () => {
  it("Meta: code → short-lived → long-lived user token → each Page (Page token) and its Instagram account; revoking removes the grant", async () => {
    const c = await consent(authorizeUrl("meta", { state: "st-meta" }, env));
    const tokens = await exchangeCode("meta", { code: c.code }, env);
    const accounts = await accountsFor("meta", tokens, env);
    expect(accounts.map((a) => [a.network, a.accountId, a.accountName])).toEqual([
      ["facebook", "page-1", "Sunny Bakery"],
      ["instagram", "ig-1", "@sunnybakery"],
    ]);
    const page = accounts[0];
    expect(page?.grantToken).toBe(tokens.accessToken);
    expect(page?.accessToken).not.toBe(tokens.accessToken);
    expect(page?.accessExpiresAt).toBeNull(); // Page tokens from a long-lived user token do not expire
    // Every Graph call carries appsecret_proof; a wrong app secret is refused by the API.
    await expect(
      graph("GET", "/me", { fields: "id" }, tokens.accessToken, {
        env: { ...env, META_APP_SECRET: "wrong" },
      }),
    ).rejects.toMatchObject({ code: "100" });
    expect(
      await revokeGrant(
        "meta",
        {
          accessToken: page?.accessToken ?? "",
          refreshToken: null,
          grantToken: page?.grantToken ?? null,
          grantSubject: "fb-user-1",
        },
        env,
      ),
    ).toBe("revoked");
    const after = await graph("GET", "/me", { fields: "id" }, tokens.accessToken, { env }).catch(
      (e: unknown) => e,
    );
    expect((after as ProviderError).unauthorized).toBe(true);
  });
});

describe("X OAuth contract", () => {
  it("X: PKCE code exchange with HTTP Basic client auth, refresh tokens rotate, revoke invalidates the tokens", async () => {
    const pkce = pkcePair();
    const c = await consent(authorizeUrl("x", { state: "st-x", challenge: pkce.challenge }, env));
    // The wrong verifier is refused (PKCE), the right one gives tokens.
    await expect(
      exchangeCode("x", { code: c.code, verifier: pkcePair().verifier }, env),
    ).rejects.toMatchObject({ status: 400 });
    const c2 = await consent(authorizeUrl("x", { state: "st-x", challenge: pkce.challenge }, env));
    const tokens = await exchangeCode("x", { code: c2.code, verifier: pkce.verifier }, env);
    expect(tokens.expiresIn).toBe(7200);
    expect(tokens.refreshToken).toBeTruthy();
    const [account] = await accountsFor("x", tokens, env);
    expect(account).toMatchObject({
      network: "x",
      accountId: "x-user-1",
      accountName: "@sunnybakery",
    });
    const fresh = await refreshTokens("x", tokens.refreshToken as string, env);
    expect(fresh.refreshToken).not.toBe(tokens.refreshToken);
    await expect(refreshTokens("x", tokens.refreshToken as string, env)).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await revokeGrant(
        "x",
        {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken,
          grantToken: null,
          grantSubject: "x-user-1",
        },
        env,
      ),
    ).toBe("revoked");
    await expect(accountsFor("x", fresh, env)).rejects.toMatchObject({ status: 401 });
  });
});

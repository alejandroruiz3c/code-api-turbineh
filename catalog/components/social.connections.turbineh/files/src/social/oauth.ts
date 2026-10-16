import { createHash, randomBytes } from "node:crypto";
import { graph } from "./graph";
import { providerFetch, ProviderError } from "./http";
import {
  credentials,
  endpoints,
  redirectUri,
  SCOPES,
  type Network,
  type Provider,
} from "./networks";

/**
 * OAuth 2.0 with each provider (component social.connections.turbineh), as their official docs describe it:
 *  - LinkedIn: 3-legged authorization code (www.linkedin.com/oauth/v2/authorization → /accessToken); refresh tokens
 *    only for apps LinkedIn enabled for programmatic refresh; no token revocation endpoint (members remove the app in
 *    their LinkedIn settings). PKCE is LinkedIn's native-app flow only, so it is not used here.
 *  - Meta: Facebook Login for Business (dialog/oauth → /oauth/access_token), exchanged for a long-lived user token;
 *    Page tokens from /me/accounts; revoke = DELETE /{user-id}/permissions.
 *  - X: Authorization Code with PKCE (S256), confidential client (HTTP Basic), refresh with offline.access (tokens
 *    rotate), revoke = POST /2/oauth2/revoke.
 * Pure functions over fetch: no database, no logging; tokens are returned to the caller, which seals them.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds, when the provider says. */
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  scope: string | null;
}

export interface ConnectedAccount {
  network: Network;
  accountId: string;
  accountName: string;
  grantSubject: string;
  accessToken: string;
  refreshToken: string | null;
  /** Meta: the long-lived user token behind a Page token (revocation). */
  grantToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  scopes: string;
}

type Env = Record<string, string | undefined>;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const newState = () => randomBytes(24).toString("base64url");

function creds(provider: Provider, env: Env) {
  const c = credentials(provider, env);
  if (!c) throw new ProviderError("oauth", 0, "not_configured", `${provider} is not configured`);
  return c;
}

/** The provider's consent page for this attempt. */
export function authorizeUrl(
  provider: Provider,
  input: { state: string; challenge?: string },
  env: Env = process.env,
): string {
  const { clientId } = creds(provider, env);
  const e = endpoints(env);
  const redirect = redirectUri(provider, env);
  if (provider === "linkedin") {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      state: input.state,
      scope: SCOPES.linkedin.join(" "),
    });
    return `${e.linkedin.auth}/oauth/v2/authorization?${q}`;
  }
  if (provider === "meta") {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      state: input.state,
      response_type: "code",
    });
    // Facebook Login for Business: a configuration id (set up in the App Dashboard) replaces the scope list.
    if (env.META_LOGIN_CONFIG_ID) q.set("config_id", env.META_LOGIN_CONFIG_ID);
    else q.set("scope", SCOPES.meta.join(","));
    return `${e.meta.auth}/dialog/oauth?${q}`;
  }
  if (!input.challenge) throw new Error("X requires PKCE");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope: SCOPES.x.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${e.x.auth}/i/oauth2/authorize?${q}`;
}

interface RawToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
}

function tokenSet(raw: RawToken, provider: Provider): TokenSet {
  if (!raw.access_token)
    throw new ProviderError(
      provider === "x" ? "x" : "oauth",
      200,
      "no_token",
      "no access token in the answer",
    );
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresIn: typeof raw.expires_in === "number" ? raw.expires_in : null,
    refreshExpiresIn:
      typeof raw.refresh_token_expires_in === "number" ? raw.refresh_token_expires_in : null,
    scope: raw.scope ?? null,
  };
}

const form = (data: Record<string, string>) => ({
  "content-type": "application/x-www-form-urlencoded",
  body: new URLSearchParams(data).toString(),
});

const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;

async function post(
  provider: Provider,
  url: string,
  data: Record<string, string>,
  auth?: string,
  fetchImpl?: typeof fetch,
) {
  const f = form(data);
  const res = await providerFetch<RawToken>(
    provider === "x" ? "x" : "oauth",
    url,
    {
      method: "POST",
      headers: {
        "content-type": f["content-type"],
        accept: "application/json",
        ...(auth ? { authorization: auth } : {}),
      },
      body: f.body,
    },
    fetchImpl,
  );
  return res.body;
}

/** Exchanges the authorization code for tokens (Meta: then for a long-lived user token). */
export async function exchangeCode(
  provider: Provider,
  input: { code: string; verifier?: string | null },
  env: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<TokenSet> {
  const { clientId, clientSecret } = creds(provider, env);
  const e = endpoints(env);
  const redirect = redirectUri(provider, env);
  if (provider === "linkedin") {
    const raw = await post(
      provider,
      `${e.linkedin.auth}/oauth/v2/accessToken`,
      {
        grant_type: "authorization_code",
        code: input.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect,
      },
      undefined,
      fetchImpl,
    );
    return tokenSet(raw, provider);
  }
  if (provider === "meta") {
    const q = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      code: input.code,
    });
    const short = await providerFetch<RawToken>(
      "oauth",
      `${e.meta.api}/oauth/access_token?${q}`,
      {},
      fetchImpl,
    );
    const lq = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: tokenSet(short.body, provider).accessToken,
    });
    const long = await providerFetch<RawToken>(
      "oauth",
      `${e.meta.api}/oauth/access_token?${lq}`,
      {},
      fetchImpl,
    );
    return tokenSet(long.body, provider);
  }
  if (!input.verifier) throw new Error("X requires the PKCE verifier");
  const raw = await post(
    provider,
    `${e.x.api}/2/oauth2/token`,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirect,
      code_verifier: input.verifier,
    },
    basic(clientId, clientSecret),
    fetchImpl,
  );
  return tokenSet(raw, provider);
}

/** A new access token from a refresh token (X always; LinkedIn only for apps with programmatic refresh). */
export async function refreshTokens(
  provider: Provider,
  refreshToken: string,
  env: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<TokenSet> {
  const { clientId, clientSecret } = creds(provider, env);
  const e = endpoints(env);
  if (provider === "linkedin")
    return tokenSet(
      await post(
        provider,
        `${e.linkedin.auth}/oauth/v2/accessToken`,
        {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        },
        undefined,
        fetchImpl,
      ),
      provider,
    );
  if (provider === "x")
    return tokenSet(
      await post(
        provider,
        `${e.x.api}/2/oauth2/token`,
        { grant_type: "refresh_token", refresh_token: refreshToken },
        basic(clientId, clientSecret),
        fetchImpl,
      ),
      provider,
    );
  throw new ProviderError(
    "oauth",
    0,
    "no_refresh",
    "Meta Page tokens do not use refresh tokens: connect again",
  );
}

const expiry = (seconds: number | null, now: Date) =>
  seconds === null ? null : new Date(now.getTime() + seconds * 1000);

/** The accounts a grant gives access to: the member (LinkedIn), the X account, or every Page and its Instagram account. */
export async function accountsFor(
  provider: Provider,
  tokens: TokenSet,
  env: Env = process.env,
  fetchImpl?: typeof fetch,
  now = new Date(),
): Promise<ConnectedAccount[]> {
  const e = endpoints(env);
  const bearer = { authorization: `Bearer ${tokens.accessToken}` };
  const common = {
    refreshToken: tokens.refreshToken,
    accessExpiresAt: expiry(tokens.expiresIn, now),
    refreshExpiresAt: expiry(tokens.refreshExpiresIn, now),
    scopes: tokens.scope ?? "",
  };
  if (provider === "linkedin") {
    const me = await providerFetch<{ sub?: string; name?: string }>(
      "linkedin",
      `${e.linkedin.api}/v2/userinfo`,
      { headers: bearer },
      fetchImpl,
    );
    if (!me.body.sub)
      throw new ProviderError("linkedin", 200, "no_sub", "userinfo has no member id");
    return [
      {
        network: "linkedin",
        accountId: me.body.sub,
        accountName: me.body.name ?? "LinkedIn member",
        grantSubject: me.body.sub,
        accessToken: tokens.accessToken,
        grantToken: null,
        ...common,
      },
    ];
  }
  if (provider === "x") {
    const me = await providerFetch<{ data?: { id?: string; username?: string; name?: string } }>(
      "x",
      `${e.x.api}/2/users/me`,
      { headers: bearer },
      fetchImpl,
    );
    const d = me.body.data;
    if (!d?.id) throw new ProviderError("x", 200, "no_id", "users/me has no id");
    return [
      {
        network: "x",
        accountId: d.id,
        accountName: d.username ? `@${d.username}` : (d.name ?? "X account"),
        grantSubject: d.id,
        accessToken: tokens.accessToken,
        grantToken: null,
        ...common,
      },
    ];
  }
  const g = { env, fetchImpl };
  const me = await graph<{ id?: string }>(
    "GET",
    "/me",
    { fields: "id,name" },
    tokens.accessToken,
    g,
  );
  const userId = me.body.id;
  if (!userId) throw new ProviderError("facebook", 200, "no_id", "/me has no id");
  const pages = await graph<{
    data?: {
      id: string;
      name: string;
      access_token?: string;
      instagram_business_account?: { id: string; username?: string };
    }[];
  }>(
    "GET",
    "/me/accounts",
    { fields: "id,name,access_token,instagram_business_account{id,username}" },
    tokens.accessToken,
    g,
  );
  const out: ConnectedAccount[] = [];
  for (const p of pages.body.data ?? []) {
    if (!p.access_token) continue;
    // Page tokens obtained with a long-lived user token have no fixed expiry.
    const page = {
      grantSubject: userId,
      accessToken: p.access_token,
      refreshToken: null,
      grantToken: tokens.accessToken,
      accessExpiresAt: null,
      refreshExpiresAt: null,
      scopes: tokens.scope ?? "",
    };
    out.push({ network: "facebook", accountId: p.id, accountName: p.name, ...page });
    const ig = p.instagram_business_account;
    if (ig?.id)
      out.push({
        network: "instagram",
        accountId: ig.id,
        accountName: ig.username ? `@${ig.username}` : `${p.name} (Instagram)`,
        ...page,
      });
  }
  return out;
}

/**
 * Revokes the grant at the provider when it offers a way to: X (access and refresh tokens), Meta (the app's
 * permissions for that user). LinkedIn has no revocation endpoint: "local" means the tokens were deleted here and the
 * member removes the app at linkedin.com (Settings › Data privacy › Permitted services).
 */
export async function revokeGrant(
  provider: Provider,
  input: {
    accessToken: string;
    refreshToken: string | null;
    grantToken: string | null;
    grantSubject: string;
  },
  env: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<"revoked" | "local"> {
  const e = endpoints(env);
  if (provider === "linkedin") return "local";
  if (provider === "x") {
    const { clientId, clientSecret } = creds(provider, env);
    for (const token of [input.refreshToken, input.accessToken].filter((t): t is string =>
      Boolean(t),
    ))
      await post(
        provider,
        `${e.x.api}/2/oauth2/revoke`,
        { token },
        basic(clientId, clientSecret),
        fetchImpl,
      );
    return "revoked";
  }
  await graph(
    "DELETE",
    `/${encodeURIComponent(input.grantSubject)}/permissions`,
    {},
    input.grantToken ?? input.accessToken,
    { env, fetchImpl },
  );
  return "revoked";
}

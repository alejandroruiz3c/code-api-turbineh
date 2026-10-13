import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { GithubConnection, OAuthStateRow } from "@turbineh/db";

/**
 * "Connect GitHub" for the product area (PLAN §16 P5, ADR-0034): an OAuth flow bound to the access workspace,
 * separate from any sign-in. Protections:
 *  - state: 32 random bytes, kept raw only in an httpOnly/Secure/SameSite=Lax cookie scoped to the callback path and
 *    in GitHub's redirect; the server stores only its SHA-256 (one use, 10 minutes). The callback requires the
 *    cookie to equal the returned state (login-CSRF safe) and the stored row to exist.
 *  - PKCE (S256): the verifier is stored encrypted next to the state hash and sent only in the server-side code
 *    exchange, so a stolen code is useless.
 *  - workspace binding: the state row names the workspace; the callback refuses a browser whose access cookie is for
 *    another workspace (except CLI tickets, whose binding is the one-time ticket plus a code shown on both sides).
 *  - minimal scopes: `public_repo` by default, `repo` only when the user asks for private repositories.
 *  - the token is AES-256-GCM encrypted at rest (DELIVERY_TOKEN_KEY), never returned, never logged.
 * The core is dependency-injected so it is tested without a database or GitHub.
 */
export const STATE_COOKIE = "tbh_gh_state";
export const CALLBACK_PATH = "/api/auth/callback/github/workspace";
export const CONNECT_PATH = "/api/github/connect";

export const b64url = (b: Buffer) => b.toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const scopesFor = (privateRepos: boolean) => (privateRepos ? "repo" : "public_repo");

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function sameSecret(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Same-site return paths only ("/flows/123?x=1"), never "//host" or absolute URLs. */
export const safeReturn = (v: string | null | undefined, fallback = "/flows/new") =>
  typeof v === "string" && /^\/(?![/\\])[\w\-/?=&%.]*$/.test(v) && v.length <= 300 ? v : fallback;

export interface OAuthDeps {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  seal: (plain: string) => string;
  open: (sealed: string) => string;
  saveState: (s: OAuthStateRow & { stateHash: string }) => Promise<void>;
  takeState: (stateHash: string) => Promise<OAuthStateRow | null>;
  saveConnection: (c: {
    ownerId: string;
    tokenEnc: string;
    login: string;
    scopes: string;
    privateRepos: boolean;
    via: "oauth" | "token";
  }) => Promise<void>;
  fetch: typeof fetch;
}

/** Builds the authorize URL and stores the state (hash) with the encrypted PKCE verifier. */
export async function startOAuth(
  deps: OAuthDeps,
  input: { ownerId: string; privateRepos: boolean; returnTo: string; viaTicket: boolean },
): Promise<{ url: string; state: string }> {
  const state = b64url(randomBytes(32));
  const { verifier, challenge } = pkce();
  await deps.saveState({
    stateHash: sha256(state),
    ownerId: input.ownerId,
    verifierEnc: deps.seal(verifier),
    privateRepos: input.privateRepos,
    returnTo: safeReturn(input.returnTo),
    viaTicket: input.viaTicket,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", deps.clientId);
  url.searchParams.set("redirect_uri", deps.redirectUri);
  url.searchParams.set("scope", scopesFor(input.privateRepos));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return { url: url.toString(), state };
}

export type FinishResult =
  | {
      ok: true;
      ownerId: string;
      login: string;
      privateRepos: boolean;
      returnTo: string;
      viaTicket: boolean;
    }
  | {
      ok: false;
      reason: "invalid_state" | "wrong_workspace" | "cancelled" | "exchange_failed";
      returnTo?: string;
    };

/**
 * Callback: cookie state == returned state, stored row (one use, unexpired), same workspace, then the code
 * exchange with the PKCE verifier and the encrypted save. Never returns or logs the token.
 */
export async function finishOAuth(
  deps: OAuthDeps,
  input: {
    state: string | null;
    cookieState: string | null | undefined;
    code: string | null;
    error: string | null;
    /** Workspace of the browser's access cookie, if any. */
    callerOwnerId: string | null;
  },
): Promise<FinishResult> {
  if (!input.state || !sameSecret(input.state, input.cookieState))
    return { ok: false, reason: "invalid_state" };
  const row = await deps.takeState(sha256(input.state));
  if (!row) return { ok: false, reason: "invalid_state" };
  if (!row.viaTicket && row.ownerId !== input.callerOwnerId)
    return { ok: false, reason: "wrong_workspace", returnTo: row.returnTo };
  if (input.error || !input.code) return { ok: false, reason: "cancelled", returnTo: row.returnTo };
  let token: string;
  let scopes: string;
  try {
    const res = await deps.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        code: input.code,
        redirect_uri: deps.redirectUri,
        code_verifier: deps.open(row.verifierEnc),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      scope?: string;
      error?: string;
    };
    if (!res.ok || !body.access_token)
      return { ok: false, reason: "exchange_failed", returnTo: row.returnTo };
    token = body.access_token;
    scopes = body.scope ?? "";
  } catch {
    return { ok: false, reason: "exchange_failed", returnTo: row.returnTo };
  }
  const user = await whoAmI(deps.fetch, token);
  if (!user) return { ok: false, reason: "exchange_failed", returnTo: row.returnTo };
  const privateRepos = scopes.split(/[ ,]+/).includes("repo");
  await deps.saveConnection({
    ownerId: row.ownerId,
    tokenEnc: deps.seal(token),
    login: user.login,
    scopes,
    privateRepos,
    via: "oauth",
  });
  return {
    ok: true,
    ownerId: row.ownerId,
    login: user.login,
    privateRepos,
    returnTo: row.returnTo,
    viaTicket: row.viaTicket,
  };
}

/** The account behind a token, plus its classic OAuth scopes (empty for fine-grained tokens). */
export async function whoAmI(
  fetchImpl: typeof fetch,
  token: string,
): Promise<{ login: string; scopes: string } | null> {
  const res = await fetchImpl("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "turbineh",
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const u = (await res.json().catch(() => null)) as { login?: string } | null;
  return u?.login ? { login: u.login, scopes: res.headers.get("x-oauth-scopes") ?? "" } : null;
}

/** Revokes the OAuth grant at GitHub (Disconnect). Best effort: the local row is deleted regardless. */
export async function revokeGrant(
  fetchImpl: typeof fetch,
  clientId: string,
  clientSecret: string,
  token: string,
): Promise<boolean> {
  const res = await fetchImpl(`https://api.github.com/applications/${clientId}/grant`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "turbineh",
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return res?.status === 204;
}

/** Public view of a connection: never the token. */
export function connectionView(c: GithubConnection | null) {
  return c
    ? {
        connected: true as const,
        login: c.login,
        private_repos: c.privateRepos,
        scopes: c.scopes ? c.scopes.split(/[ ,]+/).filter(Boolean) : [],
        via: c.via,
        connected_at: c.connectedAt,
      }
    : { connected: false as const };
}

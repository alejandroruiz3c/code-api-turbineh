import { createHash, randomBytes } from "node:crypto";
import { safeMessage } from "./vercel.js";

/**
 * Sign-in with Vercel and Neon for "Deploy for me" (ADR-0021). Pure helpers: URLs and code exchanges. The web app
 * stores state, PKCE verifier and tokens (encrypted) and binds them to one user and one build.
 */

export const randomState = (): string => randomBytes(24).toString("base64url");

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Vercel integration, external installation flow: https://vercel.com/integrations/:slug/new?state=… */
export function vercelInstallUrl(slug: string, state: string): string {
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) throw new Error("invalid Vercel integration slug");
  return `https://vercel.com/integrations/${slug}/new?${new URLSearchParams({ state }).toString()}`;
}

export async function exchangeVercelCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ token: string; teamId: string | null; configurationId: string | null }> {
  const res = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${safeMessage(text)}`);
  const body = JSON.parse(text) as {
    access_token?: string;
    team_id?: string | null;
    installation_id?: string | null;
  };
  if (!body.access_token) throw new Error("Vercel did not return an access token");
  return {
    token: body.access_token,
    teamId: body.team_id ?? null,
    configurationId: body.installation_id ?? null,
  };
}

const NEON_OAUTH = "https://oauth2.neon.tech/oauth2";
/** Only what "Deploy for me" needs: create one project and read its connection string. */
export const NEON_SCOPES = [
  "openid",
  "urn:neoncloud:projects:create",
  "urn:neoncloud:projects:read",
];

export function neonAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  return `${NEON_OAUTH}/auth?${new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: NEON_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  }).toString()}`;
}

export async function exchangeNeonCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<{ token: string }> {
  const res = await fetch(`${NEON_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${res.status}: ${safeMessage(text)}`);
  const body = JSON.parse(text) as { access_token?: string };
  if (!body.access_token) throw new Error("Neon did not return an access token");
  return { token: body.access_token };
}

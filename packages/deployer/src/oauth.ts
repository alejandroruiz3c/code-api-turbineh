import { randomBytes } from "node:crypto";
import { safeMessage } from "./vercel.js";

/**
 * Sign-in with Vercel for "Deploy for me" (ADR-0021). Pure helpers: install URL and code exchange. The web app
 * stores state and token (encrypted) and binds them to one user and one build.
 */

export const randomState = (): string => randomBytes(24).toString("base64url");

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

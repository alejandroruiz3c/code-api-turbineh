import { encrypt } from "@turbineh/shared";
import { db } from "./db";
import { env } from "./env";

export type Provider = "vercel" | "neon";

/** Which sign-in options are configured on this deployment of TurbineH. */
export const providerEnabled = (p: Provider): boolean =>
  p === "vercel"
    ? Boolean(
        env.VERCEL_INTEGRATION_SLUG &&
        env.VERCEL_INTEGRATION_CLIENT_ID &&
        env.VERCEL_INTEGRATION_CLIENT_SECRET,
      )
    : Boolean(env.NEON_OAUTH_CLIENT_ID && env.NEON_OAUTH_CLIENT_SECRET);

export const redirectUri = (p: Provider): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/deploy/${p}/callback`;

/** Latest connected (token present, not expired) sign-in of this user for this build. No secrets returned. */
export async function connectionStatus(
  ownerId: string,
  buildId: string,
): Promise<Record<Provider, { enabled: boolean; connected: boolean; label: string | null }>> {
  const res = await db.query<{ provider: Provider; label: string | null }>(
    `SELECT DISTINCT ON (provider) provider, label FROM deploy_connections
     WHERE owner_id = $1 AND build_id = $2 AND token_enc IS NOT NULL AND expires_at > now()
     ORDER BY provider, created_at DESC`,
    [ownerId, buildId],
  );
  const found = new Map(res.rows.map((r) => [r.provider, r.label]));
  const one = (p: Provider) => ({
    enabled: providerEnabled(p),
    connected: found.has(p),
    label: found.get(p) ?? null,
  });
  return { vercel: one("vercel"), neon: one("neon") };
}

/**
 * Takes the connected token for a deployment: returned once (still encrypted with the same key) and deleted, so a
 * token is used by at most one deployment.
 */
export async function takeConnection(
  ownerId: string,
  buildId: string,
  provider: Provider,
): Promise<{ tokenEnc: string; teamId: string | null } | null> {
  const res = await db.query<{ token_enc: string; team_id: string | null }>(
    `DELETE FROM deploy_connections WHERE state = (
       SELECT state FROM deploy_connections
       WHERE owner_id = $1 AND build_id = $2 AND provider = $3 AND token_enc IS NOT NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1)
     RETURNING token_enc, team_id`,
    [ownerId, buildId, provider],
  );
  await db.query("DELETE FROM deploy_connections WHERE expires_at < now()");
  const row = res.rows[0];
  return row ? { tokenEnc: row.token_enc, teamId: row.team_id } : null;
}

export const seal = (value: string): string => encrypt(value, env.DELIVERY_TOKEN_KEY);

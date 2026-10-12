import { encrypt } from "@turbineh/shared";
import { db } from "./db";
import { env } from "./env";

/** "Connect Vercel" is offered only when the TurbineH integration is configured on this deployment (ADR-0021). */
export const vercelSignInEnabled = (): boolean =>
  Boolean(
    env.VERCEL_INTEGRATION_SLUG &&
    env.VERCEL_INTEGRATION_CLIENT_ID &&
    env.VERCEL_INTEGRATION_CLIENT_SECRET,
  );

export const vercelRedirectUri = (): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/deploy/vercel/callback`;

/** Latest connected (token present, not expired) Vercel sign-in of this user for this build. No secrets returned. */
export async function connectionStatus(
  ownerId: string,
  buildId: string,
): Promise<{ vercel: { enabled: boolean; connected: boolean; label: string | null } }> {
  const res = await db.query<{ label: string | null }>(
    `SELECT label FROM deploy_connections
     WHERE owner_id = $1 AND build_id = $2 AND provider = 'vercel' AND token_enc IS NOT NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [ownerId, buildId],
  );
  const row = res.rows[0];
  return {
    vercel: { enabled: vercelSignInEnabled(), connected: Boolean(row), label: row?.label ?? null },
  };
}

/**
 * Takes the connected Vercel token for a deployment: returned once (still encrypted with the same key) and deleted,
 * so a token is used by at most one deployment.
 */
export async function takeConnection(
  ownerId: string,
  buildId: string,
): Promise<{ tokenEnc: string; teamId: string | null } | null> {
  const res = await db.query<{ token_enc: string; team_id: string | null }>(
    `DELETE FROM deploy_connections WHERE state = (
       SELECT state FROM deploy_connections
       WHERE owner_id = $1 AND build_id = $2 AND provider = 'vercel' AND token_enc IS NOT NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1)
     RETURNING token_enc, team_id`,
    [ownerId, buildId],
  );
  await db.query("DELETE FROM deploy_connections WHERE expires_at < now()");
  const row = res.rows[0];
  return row ? { tokenEnc: row.token_enc, teamId: row.team_id } : null;
}

export const seal = (value: string): string => encrypt(value, env.DELIVERY_TOKEN_KEY);

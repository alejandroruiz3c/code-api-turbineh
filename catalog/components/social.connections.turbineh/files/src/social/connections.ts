import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections, socialOauthStates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import { can, type Role } from "@/server/authz";
import { connectionsConfig } from "./config";
import { decryptToken, encryptToken, tokenKeyConfigured, type TokenBinding } from "./crypto";
import { ProviderError } from "./http";
import {
  CREDENTIAL_ENV,
  credentials,
  providerOf,
  PROVIDER_LABEL,
  type Network,
  type Provider,
} from "./networks";
import {
  accountsFor,
  authorizeUrl,
  exchangeCode,
  newState,
  pkcePair,
  refreshTokens,
  revokeGrant,
  type ConnectedAccount,
} from "./oauth";

/**
 * Connected social accounts (component social.connections.turbineh): connect (OAuth), list, use and revoke. Tokens are
 * sealed (AES-256-GCM) before they touch the database and opened only inside `accessTokenFor`, for one provider call.
 * Connecting and disconnecting are workspace settings: `can(role, "configure")`.
 */
export interface Ctx {
  userId: string;
  organizationId: string;
  role: Role;
  email?: string;
}

/** What screens and other components may read about a connection: never a token. */
export const PUBLIC_COLUMNS = {
  id: socialConnections.id,
  network: socialConnections.network,
  accountId: socialConnections.accountId,
  accountName: socialConnections.accountName,
  status: socialConnections.status,
  scopes: socialConnections.scopes,
  accessExpiresAt: socialConnections.accessExpiresAt,
  lastError: socialConnections.lastError,
  connectedAt: socialConnections.connectedAt,
  revokedAt: socialConnections.revokedAt,
} as const;

export type ConnectionView = {
  id: string;
  network: string;
  accountId: string;
  accountName: string;
  status: string;
  scopes: string;
  accessExpiresAt: Date | null;
  lastError: string | null;
  connectedAt: Date;
  revokedAt: Date | null;
};

const STATE_TTL_MS = 10 * 60_000;
/** Access tokens closer than this to their expiry are refreshed before use (when the provider gave a refresh token). */
const REFRESH_MARGIN_MS = 5 * 60_000;

function requireConfigure(ctx: Ctx) {
  if (!can(ctx.role, "configure"))
    throw new UserFacingError(
      "Only people who manage the workspace settings can connect or disconnect social accounts.",
    );
}

/** Why a provider cannot be connected right now (missing key or app credentials), or null when it can. */
export function setupProblem(provider: Provider): string | null {
  if (!connectionsConfig.providers.includes(provider))
    return `${PROVIDER_LABEL[provider]} is not enabled in this app.`;
  if (!tokenKeyConfigured())
    return "Set SOCIAL_TOKEN_KEY (32 random bytes, base64) to store tokens encrypted.";
  if (!credentials(provider))
    return `Set ${CREDENTIAL_ENV[provider].join(" and ")} (your ${PROVIDER_LABEL[provider]} app).`;
  return null;
}

const bind = (
  organizationId: string,
  network: string,
  accountId: string,
  kind: TokenBinding["kind"],
): TokenBinding => ({
  organizationId,
  network,
  accountId,
  kind,
});

/** Starts an OAuth attempt: a single-use state bound to this person and workspace (and a PKCE verifier for X). */
export async function startConnect(ctx: Ctx, provider: Provider): Promise<string> {
  requireConfigure(ctx);
  const problem = setupProblem(provider);
  if (problem) throw new UserFacingError(problem);
  await db.delete(socialOauthStates).where(lt(socialOauthStates.expiresAt, new Date()));
  const state = newState();
  const pkce = provider === "x" ? pkcePair() : null;
  await db.insert(socialOauthStates).values({
    state,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    network: provider,
    verifierSealed: pkce
      ? encryptToken(pkce.verifier, bind(ctx.organizationId, provider, state, "verifier"))
      : null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return authorizeUrl(provider, { state, challenge: pkce?.challenge });
}

/** Seals and stores the accounts of a grant (one row per account; reconnecting replaces the tokens). */
async function saveAccounts(ctx: Ctx, accounts: ConnectedAccount[]): Promise<number> {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const a of accounts) {
      const seal = (plain: string | null, kind: TokenBinding["kind"]) =>
        plain ? encryptToken(plain, bind(ctx.organizationId, a.network, a.accountId, kind)) : null;
      const values = {
        accountName: a.accountName.slice(0, 200),
        grantSubject: a.grantSubject,
        scopes: a.scopes.slice(0, 1000),
        accessTokenSealed: seal(a.accessToken, "access") as string,
        refreshTokenSealed: seal(a.refreshToken, "refresh"),
        grantTokenSealed: seal(a.grantToken, "grant"),
        accessExpiresAt: a.accessExpiresAt,
        refreshExpiresAt: a.refreshExpiresAt,
        status: "active",
        lastError: null,
        connectedBy: ctx.userId,
        updatedAt: now,
        revokedAt: null,
      };
      const [row] = await tx
        .insert(socialConnections)
        .values({
          organizationId: ctx.organizationId,
          network: a.network,
          accountId: a.accountId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            socialConnections.organizationId,
            socialConnections.network,
            socialConnections.accountId,
          ],
          set: { ...values, connectedAt: now },
        })
        .returning({ id: socialConnections.id });
      await audit(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          actorEmail: ctx.email ?? null,
          action: "social.connected",
          subjectType: "social_connection",
          subjectId: row?.id ?? null,
          summary: `Connected ${a.network} account ${a.accountName}`,
        },
        tx,
      );
    }
  });
  return accounts.length;
}

/** Finishes an OAuth attempt from the provider's redirect: checks the state, exchanges the code, stores the accounts. */
export async function finishConnect(
  ctx: Ctx,
  provider: Provider,
  query: { code: string | null; state: string | null; error: string | null },
): Promise<{ connected: number }> {
  requireConfigure(ctx);
  if (!query.state)
    throw new UserFacingError(
      "The provider did not return the sign-in state. Try connecting again.",
    );
  // Single use: the row is deleted as it is read, and must belong to this person, workspace and provider.
  const [attempt] = await db
    .delete(socialOauthStates)
    .where(
      and(
        eq(socialOauthStates.state, query.state),
        eq(socialOauthStates.organizationId, ctx.organizationId),
        eq(socialOauthStates.userId, ctx.userId),
        eq(socialOauthStates.network, provider),
        gt(socialOauthStates.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!attempt)
    throw new UserFacingError(
      "This sign-in link expired or was already used. Try connecting again.",
    );
  if (query.error || !query.code)
    throw new UserFacingError(
      `${PROVIDER_LABEL[provider]} access was not granted (${(query.error ?? "no code").slice(0, 60)}).`,
    );
  const verifier = attempt.verifierSealed
    ? decryptToken(
        attempt.verifierSealed,
        bind(ctx.organizationId, provider, attempt.state, "verifier"),
      )
    : null;
  try {
    const tokens = await exchangeCode(provider, { code: query.code, verifier });
    const accounts = await accountsFor(provider, tokens);
    if (accounts.length === 0)
      throw new UserFacingError(
        provider === "meta"
          ? "No Facebook Page was shared with this app. Connect again and select the Pages (and their Instagram accounts) to manage."
          : "No account was returned by the provider.",
      );
    return { connected: await saveAccounts(ctx, accounts) };
  } catch (err) {
    if (err instanceof ProviderError)
      throw new UserFacingError(
        `${PROVIDER_LABEL[provider]} refused the connection (${err.summary}).`,
      );
    throw err;
  }
}

export async function listConnections(organizationId: string): Promise<ConnectionView[]> {
  return db
    .select(PUBLIC_COLUMNS)
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.organizationId, organizationId),
        ne(socialConnections.status, "revoked"),
      ),
    )
    .orderBy(socialConnections.network, socialConnections.accountName);
}

export async function getConnection(
  organizationId: string,
  id: string,
): Promise<ConnectionView | null> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(socialConnections)
    .where(and(eq(socialConnections.organizationId, organizationId), eq(socialConnections.id, id)));
  return row ?? null;
}

/** Marks a connection as needing a new sign-in (token refused or expired). */
export async function markExpired(
  organizationId: string,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(socialConnections)
    .set({ status: "expired", lastError: reason.slice(0, 300), updatedAt: new Date() })
    .where(and(eq(socialConnections.organizationId, organizationId), eq(socialConnections.id, id)));
}

/**
 * The plain access token of a connection, for one provider call (server only). Refreshes it first when it is about to
 * expire and the provider gave a refresh token (X rotates refresh tokens: the new one is stored). An expired token
 * without a refresh token marks the connection `expired` and throws.
 */
export async function accessTokenFor(
  organizationId: string,
  connectionId: string,
  now = new Date(),
): Promise<{ token: string; accountId: string; network: Network }> {
  const [c] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.organizationId, organizationId),
        eq(socialConnections.id, connectionId),
      ),
    );
  if (!c || c.status === "revoked")
    throw new UserFacingError("This social account is no longer connected.");
  const network = c.network as Network;
  if (c.status === "expired")
    throw new ProviderError(
      network,
      401,
      "expired",
      "The connection expired: connect the account again",
    );
  const b = (kind: TokenBinding["kind"]) => bind(organizationId, c.network, c.accountId, kind);
  const expiring =
    c.accessExpiresAt && c.accessExpiresAt.getTime() - now.getTime() < REFRESH_MARGIN_MS;
  if (!expiring)
    return {
      token: decryptToken(c.accessTokenSealed, b("access")),
      accountId: c.accountId,
      network,
    };
  if (!c.refreshTokenSealed) {
    await markExpired(organizationId, c.id, "Access expired: connect the account again");
    throw new ProviderError(
      network,
      401,
      "expired",
      "The connection expired: connect the account again",
    );
  }
  try {
    // One refresh at a time per connection (X rotates refresh tokens: a second, concurrent refresh with the old one
    // would be refused). The row is locked; a runner that waited reuses the token the first one stored.
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(socialConnections)
        .where(eq(socialConnections.id, c.id))
        .for("update");
      if (!locked?.refreshTokenSealed || locked.status !== "active")
        throw new ProviderError(
          network,
          401,
          "expired",
          "The connection expired: connect the account again",
        );
      if (
        locked.accessExpiresAt &&
        locked.accessExpiresAt.getTime() - now.getTime() >= REFRESH_MARGIN_MS
      )
        return {
          token: decryptToken(locked.accessTokenSealed, b("access")),
          accountId: c.accountId,
          network,
        };
      const fresh = await refreshTokens(
        providerOf(network),
        decryptToken(locked.refreshTokenSealed, b("refresh")),
      );
      await tx
        .update(socialConnections)
        .set({
          accessTokenSealed: encryptToken(fresh.accessToken, b("access")),
          refreshTokenSealed: fresh.refreshToken
            ? encryptToken(fresh.refreshToken, b("refresh"))
            : locked.refreshTokenSealed,
          accessExpiresAt: fresh.expiresIn
            ? new Date(now.getTime() + fresh.expiresIn * 1000)
            : null,
          updatedAt: now,
          lastError: null,
        })
        .where(eq(socialConnections.id, c.id));
      return { token: fresh.accessToken, accountId: c.accountId, network };
    });
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable && err.code !== "expired") {
      await markExpired(organizationId, c.id, `Refresh refused (${err.summary})`);
      throw new ProviderError(
        network,
        401,
        "expired",
        "The connection expired: connect the account again",
      );
    }
    throw err;
  }
}

/**
 * Disconnects an account: revokes the grant at the provider when it can (X, Meta — a Meta grant covers every Page and
 * Instagram account it gave, so all of them are disconnected), then deletes the stored tokens. The tokens are deleted
 * even when the provider cannot be reached; the screen says so.
 */
export async function disconnect(
  ctx: Ctx,
  connectionId: string,
): Promise<{ revoked: "revoked" | "local"; note: string | null }> {
  requireConfigure(ctx);
  const [c] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.organizationId, ctx.organizationId),
        eq(socialConnections.id, connectionId),
      ),
    );
  if (!c || c.status === "revoked")
    throw new UserFacingError("This social account is not connected.");
  const provider = providerOf(c.network as Network);
  const b = (kind: TokenBinding["kind"]) => bind(ctx.organizationId, c.network, c.accountId, kind);
  let revoked: "revoked" | "local" = "local";
  let note: string | null = null;
  try {
    revoked = await revokeGrant(provider, {
      accessToken: decryptToken(c.accessTokenSealed, b("access")),
      refreshToken: c.refreshTokenSealed ? decryptToken(c.refreshTokenSealed, b("refresh")) : null,
      grantToken: c.grantTokenSealed ? decryptToken(c.grantTokenSealed, b("grant")) : null,
      grantSubject: c.grantSubject,
    });
  } catch (err) {
    note = `The provider could not confirm the revocation (${err instanceof ProviderError ? err.summary : "error"}); the tokens were deleted here.`;
  }
  if (revoked === "local" && !note && provider === "linkedin")
    note =
      "LinkedIn has no revocation API: the tokens were deleted here; remove the app in LinkedIn's Settings › Data privacy › Permitted services.";
  const now = new Date();
  const scope =
    provider === "meta" && revoked === "revoked"
      ? and(
          eq(socialConnections.organizationId, ctx.organizationId),
          eq(socialConnections.grantSubject, c.grantSubject),
        )
      : and(
          eq(socialConnections.organizationId, ctx.organizationId),
          eq(socialConnections.id, c.id),
        );
  await db.transaction(async (tx) => {
    const gone = await tx
      .update(socialConnections)
      .set({
        status: "revoked",
        accessTokenSealed: "",
        refreshTokenSealed: null,
        grantTokenSealed: null,
        revokedAt: now,
        updatedAt: now,
        lastError: note,
      })
      .where(scope)
      .returning({
        id: socialConnections.id,
        network: socialConnections.network,
        accountName: socialConnections.accountName,
      });
    for (const g of gone)
      await audit(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          actorEmail: ctx.email ?? null,
          action: "social.disconnected",
          subjectType: "social_connection",
          subjectId: g.id,
          summary: `Disconnected ${g.network} account ${g.accountName} (${revoked === "revoked" ? "revoked at the provider" : "tokens deleted"})`,
        },
        tx,
      );
  });
  return { revoked, note };
}

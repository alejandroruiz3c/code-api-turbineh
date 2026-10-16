import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Connected social accounts (component social.connections.turbineh): one row per account a workspace connected
 * (a LinkedIn member, a Facebook Page, an Instagram professional account, an X account). Tokens are stored only as
 * AES-256-GCM ciphertext bound to the row (src/social/crypto.ts); no screen, export, log or query of the app reads them
 * except the provider call that needs them (src/social/connections.ts `accessTokenFor`).
 */
export const socialConnections = pgTable(
  "social_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    /** linkedin | facebook | instagram | x */
    network: varchar("network", { length: 12 }).notNull(),
    /** The provider's id of the account (LinkedIn person id, Page id, Instagram user id, X user id). */
    accountId: varchar("account_id", { length: 80 }).notNull(),
    accountName: varchar("account_name", { length: 200 }).notNull(),
    /** Who on the provider granted access (Meta user id for Pages and Instagram; the account itself otherwise). */
    grantSubject: varchar("grant_subject", { length: 80 }).notNull(),
    scopes: varchar("scopes", { length: 1000 }).notNull().default(""),
    /** Ciphertext only (v1.<iv>.<tag>.<ct>). */
    accessTokenSealed: text("access_token_sealed").notNull(),
    refreshTokenSealed: text("refresh_token_sealed"),
    /** Meta: the long-lived user token that granted the Page token (used to revoke the grant). Ciphertext only. */
    grantTokenSealed: text("grant_token_sealed"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    /** active | expired (connect again) | revoked */
    status: varchar("status", { length: 12 }).notNull().default("active"),
    lastError: varchar("last_error", { length: 300 }),
    connectedBy: varchar("connected_by", { length: 64 }).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("social_connections_account_idx").on(t.organizationId, t.network, t.accountId),
    uniqueIndex("social_connections_org_id_idx").on(t.organizationId, t.id),
    index("social_connections_org_idx").on(t.organizationId, t.status),
  ],
);

/**
 * OAuth attempts in flight: the `state` sent to the provider (single use, 10 minutes), bound to the person and the
 * workspace that started it, with the PKCE verifier sealed like a token.
 */
export const socialOauthStates = pgTable("social_oauth_states", {
  state: varchar("state", { length: 64 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  network: varchar("network", { length: 12 }).notNull(),
  verifierSealed: text("verifier_sealed"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

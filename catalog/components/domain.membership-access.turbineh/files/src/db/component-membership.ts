import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Membership tables (component domain.membership-access.turbineh): invitations by email with a role (only the SHA-256
 * of the link token is stored) and per-record access scopes (company, project, shop…) with their members. Workspace
 * members and their roles live in better-auth's `member` table.
 */
export const membershipInvitations = pgTable(
  "membership_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 24 }).notNull(),
    /** Scope the invitee joins (e.g. their company); null = none. */
    scopeId: uuid("scope_id"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** pending | accepted | revoked */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    invitedBy: varchar("invited_by", { length: 64 }).notNull(),
    acceptedBy: varchar("accepted_by", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("membership_invitations_token_idx").on(t.tokenHash),
    index("membership_invitations_org_idx").on(t.organizationId, t.status),
  ],
);

/** Per-record access scopes of a workspace: records filed under a scope are seen only by its members. */
export const accessScopes = pgTable(
  "access_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("access_scopes_org_name_idx").on(t.organizationId, t.name)],
);

export const accessScopeMembers = pgTable(
  "access_scope_members",
  {
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => accessScopes.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).notNull(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.userId] }),
    index("access_scope_members_user_idx").on(t.organizationId, t.userId),
  ],
);

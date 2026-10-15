import { index, integer, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Background jobs (component jobs.queue.turbineh): Postgres-backed queue, claimed with FOR UPDATE SKIP LOCKED, leased and fenced. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** Lease (ADR-0055): the claim expires here unless the heartbeat renews it; then the job is recovered. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** Fencing token: +1 on every claim; writes from an older claim are ignored. */
    leaseToken: integer("lease_token").notNull().default(0),
    lastError: varchar("last_error", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    index("jobs_lease_idx").on(t.status, t.leaseUntil),
  ],
);

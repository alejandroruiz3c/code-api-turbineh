import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
    /**
     * Idempotency key of the enqueue (ADR-0065): the same (workspace, type, key) is one job, however many times a cron
     * or a retried request enqueues it. Null = no key (every enqueue is a new job).
     */
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    index("jobs_lease_idx").on(t.status, t.leaseUntil),
    uniqueIndex("jobs_idempotency_idx").on(t.organizationId, t.type, t.idempotencyKey),
  ],
);

/**
 * Side effects of jobs recorded before they run (`ctx.once`, ADR-0065): one row per (job, effect key). A runner whose
 * lease was taken over, a retry after a partial failure or an overlapping cron call finds the row and does not repeat
 * the effect (an email, a payment, a post).
 */
export const jobEffects = pgTable(
  "job_effects",
  {
    jobId: uuid("job_id").notNull(),
    key: varchar("key", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.key] })],
);

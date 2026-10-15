import { integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Runs of scheduled jobs (component jobs.scheduled.turbineh): one row per job and scheduled instant. The unique key
 * (job, scheduled_for) makes every run idempotent: a second call for the same occurrence — a retry, two schedulers,
 * a double click — finds the row and sends nothing.
 */
export const scheduledRuns = pgTable(
  "scheduled_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: varchar("job_id", { length: 40 }).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    /** running | done | failed (a failed run is retried by the next call). */
    status: varchar("status", { length: 12 }).notNull().default("running"),
    sent: integer("sent").notNull().default(0),
    /** "log" when no email provider is configured, "resend" otherwise. */
    transport: varchar("transport", { length: 12 }),
    error: varchar("error", { length: 120 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("scheduled_runs_job_occurrence_idx").on(t.jobId, t.scheduledFor)],
);

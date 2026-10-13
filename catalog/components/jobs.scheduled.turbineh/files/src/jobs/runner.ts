import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduledRuns } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { scheduledConfig, type Job } from "./config";
import { lastOccurrence } from "./cron";
import { DIGESTS } from "./digests";

/**
 * Scheduled-job runner (component jobs.scheduled.turbineh), called by the protected cron route. For each job it finds
 * the latest scheduled instant (cron in the job's time zone) and runs it at most once: the run is claimed by inserting
 * (job, instant) under a unique key, so retries and concurrent calls send nothing twice. Emails go through sendEmail
 * (logged when no email provider is configured).
 */
export interface RunReport {
  ran: { job: string; scheduledFor: string; sent: number; transport: string | null }[];
  skipped: { job: string; scheduledFor: string | null; reason: string }[];
  failed: { job: string; scheduledFor: string; error: string }[];
}

/** Claims (job, instant): true when this call owns the run (new, or a failed one being retried). */
async function claim(job: Job, at: Date): Promise<boolean> {
  const inserted = await db
    .insert(scheduledRuns)
    .values({ jobId: job.id, scheduledFor: at })
    .onConflictDoNothing()
    .returning({ id: scheduledRuns.id });
  if (inserted.length) return true;
  const retried = await db
    .update(scheduledRuns)
    .set({ status: "running", error: null, startedAt: new Date() })
    .where(
      and(
        eq(scheduledRuns.jobId, job.id),
        eq(scheduledRuns.scheduledFor, at),
        eq(scheduledRuns.status, "failed"),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return retried.length > 0;
}

export async function runScheduled(
  opts: { jobId?: string; now?: Date } = {},
  jobs: Job[] = scheduledConfig.jobs,
): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const report: RunReport = { ran: [], skipped: [], failed: [] };
  for (const job of jobs.filter((j) => !opts.jobId || j.id === opts.jobId)) {
    const at = lastOccurrence(job.cron, job.timeZone, now);
    if (!at) {
      report.skipped.push({ job: job.id, scheduledFor: null, reason: "not due" });
      continue;
    }
    if (!(await claim(job, at))) {
      report.skipped.push({ job: job.id, scheduledFor: at.toISOString(), reason: "already ran" });
      continue;
    }
    try {
      const messages = await DIGESTS[job.kind](job, now);
      let transport: string | null = null;
      for (const m of messages) {
        const r = await sendEmail(m);
        transport = r.transport;
      }
      await db
        .update(scheduledRuns)
        .set({ status: "done", sent: messages.length, transport, finishedAt: new Date() })
        .where(and(eq(scheduledRuns.jobId, job.id), eq(scheduledRuns.scheduledFor, at)));
      report.ran.push({
        job: job.id,
        scheduledFor: at.toISOString(),
        sent: messages.length,
        transport,
      });
    } catch (err) {
      const error = err instanceof Error ? err.name : "Error";
      await db
        .update(scheduledRuns)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(and(eq(scheduledRuns.jobId, job.id), eq(scheduledRuns.scheduledFor, at)));
      report.failed.push({ job: job.id, scheduledFor: at.toISOString(), error });
    }
  }
  return report;
}

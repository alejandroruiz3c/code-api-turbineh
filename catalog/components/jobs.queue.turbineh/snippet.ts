// Server code in the app (e.g. src/jobs/reminder.ts): a typed background job with retries, leases and idempotency.
import { z } from "zod";
import { defineJob, enqueue } from "@/lib/jobs";

const Reminder = z.object({ email: z.email() });

defineJob("email.reminder", Reminder, async (payload, ctx) => {
  if (ctx.signal.aborted) return; // the lease was lost: another runner took the job over
  // At most once per job, even if the job is retried or another runner takes it over.
  await ctx.once("send", async () => {
    console.info(`reminder for ${payload.email}`, ctx.idempotencyKey("send"));
  });
});

// The same (workspace, type, key) is one job: a double click or an overlapping cron call adds nothing.
export const queueReminder = (organizationId: string, bookingId: string, email: string) =>
  enqueue("email.reminder", { email }, { organizationId, idempotencyKey: `reminder:${bookingId}` });

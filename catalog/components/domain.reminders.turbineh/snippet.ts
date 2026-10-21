// Server code in the app: run the reminders that are due now (what the cron route's task does on every call) and list
// them for staff. Each appointment gets one reminder per channel, however often this runs.
import { runDueReminders, staffReminders } from "@/reminders/service";

export async function remindNow() {
  const report = await runDueReminders(new Date());
  const pending = (await staffReminders()).filter((r) => r.status === "scheduled");
  return { ...report, scheduled: pending.length };
}

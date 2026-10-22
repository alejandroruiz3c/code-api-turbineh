import { dailyDigest, digestRecipients, syncAndTriage } from "@/mail/triage/service";
import type { Job } from "./config";

/**
 * What each scheduled job does with mailbox triage (jobs.scheduled.turbineh with ai.mail-triage.turbineh): every job
 * first reads new mail and triages it; the daily digest (and any other emailing job) then emails the people on
 * MAIL_DIGEST_TO (or ADMIN_EMAILS) the emails that need attention, most urgent first. The job "mail-sync" only
 * synchronises. The runner sends and records the emails (logged when there is no email provider).
 */
export interface DigestMessage {
  to: string;
  subject: string;
  text: string;
}

export type Digest = (job: Job, now: Date) => Promise<DigestMessage[]>;

const mailDigest: Digest = async (job, now) => {
  await syncAndTriage();
  if (job.id === "mail-sync") return [];
  const digest = await dailyDigest(now);
  return digestRecipients().map((to) => ({ to, subject: digest.subject, text: digest.text }));
};

export const DIGESTS: Record<Job["kind"], Digest> = {
  "overdue-digest": async () => [],
  "daily-digest": mailDigest,
  custom: mailDigest,
};

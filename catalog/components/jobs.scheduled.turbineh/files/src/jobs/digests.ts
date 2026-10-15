import type { Job } from "./config";

/**
 * What each kind of scheduled job sends (component jobs.scheduled.turbineh). Without a data source the digests are
 * empty; with domain.workflow.turbineh this file is replaced by one that emails overdue and stuck records. Add a
 * "custom" job here: return the emails to send (recipients, subject, text); the runner sends and records them.
 */
export interface DigestMessage {
  to: string;
  subject: string;
  text: string;
}

export type Digest = (job: Job, now: Date) => Promise<DigestMessage[]>;

export const DIGESTS: Record<Job["kind"], Digest> = {
  "overdue-digest": async () => [],
  "daily-digest": async () => [],
  custom: async () => [],
};

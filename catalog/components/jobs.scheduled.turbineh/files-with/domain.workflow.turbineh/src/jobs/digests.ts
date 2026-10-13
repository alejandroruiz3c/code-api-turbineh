import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/env";
import { can } from "@/server/authz";
import { attentionItems } from "@/workflow/service";
import type { Job } from "./config";

/**
 * What each kind of scheduled job sends (jobs.scheduled.turbineh with domain.workflow.turbineh):
 *  - overdue-digest: every person gets the list of records they created that are overdue or stuck in a state;
 *  - daily-digest: members who manage each workspace get everything that needs attention there.
 * Add a "custom" job here: return the emails to send; the runner sends and records them.
 */
export interface DigestMessage {
  to: string;
  subject: string;
  text: string;
}

export type Digest = (job: Job, now: Date) => Promise<DigestMessage[]>;

type Attention = Awaited<ReturnType<typeof attentionItems>>[number];

const appUrl = () => env.BETTER_AUTH_URL.replace(/\/+$/, "");
const line = (i: Attention) =>
  `- ${i.workflowLabel} "${i.title}" — ${i.stateLabel}${i.overdue ? `, overdue since ${i.dueAt?.toISOString().slice(0, 10)}` : ""}${i.stuckHours !== null ? `, ${i.stuckHours} h in this state` : ""}\n  ${appUrl()}/dashboard/workflow/${i.workflow}/${i.id}`;

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

export const DIGESTS: Record<Job["kind"], Digest> = {
  "overdue-digest": async (job, now) => {
    const items = await attentionItems(null, now);
    return [...groupBy(items, (i) => i.createdByEmail)].map(([to, mine]) => ({
      to,
      subject: `Overdue: ${mine.length} ${mine.length === 1 ? "record needs" : "records need"} your attention`,
      text: [`${job.what}.`, "", ...mine.map(line)].join("\n"),
    }));
  },
  "daily-digest": async (job, now) => {
    const items = await attentionItems(null, now);
    const out: DigestMessage[] = [];
    for (const [organizationId, rows] of groupBy(items, (i) => i.organizationId)) {
      const members = await db.execute<{ email: string; role: string }>(
        sql`select u.email, m.role from member m join "user" u on u.id = m."userId"
             where m."organizationId" = ${organizationId}`,
      );
      for (const m of members.rows.filter((x) => can(x.role, "manage_members")))
        out.push({
          to: m.email,
          subject: `Daily digest: ${rows.length} ${rows.length === 1 ? "record needs" : "records need"} attention`,
          text: [`${job.what}.`, "", ...rows.map(line)].join("\n"),
        });
    }
    return out;
  },
  custom: async () => [],
};

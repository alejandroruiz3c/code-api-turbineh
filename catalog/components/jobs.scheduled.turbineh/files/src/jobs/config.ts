import { z } from "zod";
import { isTimeZone, parseCron } from "./cron";
import params from "./params.json";

/**
 * Scheduled jobs (component jobs.scheduled.turbineh), written by TurbineH from the request ("overdue tasks are emailed
 * every morning"): an id, what it does (kind), a cron expression and its time zone. Validated at start-up.
 */
const KIND = z.enum(["overdue-digest", "daily-digest", "custom"]);

/** The kind a request's words describe, when params do not say it. */
export function inferKind(what: string): z.infer<typeof KIND> {
  if (/\boverdue|\blate\b|past due|stuck/i.test(what)) return "overdue-digest";
  if (/\bdigest|summary|daily report|needs? attention/i.test(what)) return "daily-digest";
  return "custom";
}

export const JobDef = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    kind: KIND.optional(),
    cron: z.string().min(9).max(120),
    timeZone: z
      .string()
      .nullable()
      .transform((tz) => tz ?? "UTC")
      .refine(isTimeZone, "unknown IANA time zone"),
    what: z.string().min(1).max(500),
  })
  .transform((j) => ({ ...j, kind: j.kind ?? inferKind(j.what) }))
  .superRefine((j, ctx) => {
    try {
      parseCron(j.cron);
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["cron"], message: (err as Error).message });
    }
  });

export const ScheduledParams = z
  // No job of its own is fine: another component may only hand the route its tasks (src/jobs/tasks.ts).
  .object({ jobs: z.array(JobDef).max(20), logWhenNoEmailProvider: z.boolean() })
  .superRefine((p, ctx) => {
    const ids = p.jobs.map((j) => j.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["jobs"], message: "job ids must be unique" });
  });

export type Job = z.infer<typeof JobDef>;
export const scheduledConfig = ScheduledParams.parse(params);

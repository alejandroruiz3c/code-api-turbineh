import { z } from "zod";
import { isTimeZone, parseCron } from "./cron";
import params from "./params.json";

/**
 * Scheduled jobs (component jobs.scheduled.turbineh), written by TurbineH from the request ("overdue tasks are emailed
 * every morning"): an id, what it does (kind), a cron expression and its time zone. Validated at start-up.
 */
export const JobDef = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    kind: z.enum(["overdue-digest", "daily-digest", "custom"]),
    cron: z.string().min(9).max(120),
    timeZone: z.string().refine(isTimeZone, "unknown IANA time zone"),
    what: z.string().min(1).max(200),
  })
  .superRefine((j, ctx) => {
    try {
      parseCron(j.cron);
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["cron"], message: (err as Error).message });
    }
  });

export const ScheduledParams = z
  .object({ jobs: z.array(JobDef).min(1).max(20), logWhenNoEmailProvider: z.boolean() })
  .superRefine((p, ctx) => {
    const ids = p.jobs.map((j) => j.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["jobs"], message: "job ids must be unique" });
  });

export type Job = z.infer<typeof JobDef>;
export const scheduledConfig = ScheduledParams.parse(params);

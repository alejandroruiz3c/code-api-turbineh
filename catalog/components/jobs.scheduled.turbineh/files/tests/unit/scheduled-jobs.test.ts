import { describe, expect, it } from "vitest";
import { ScheduledParams, scheduledConfig } from "@/jobs/config";
import { lastOccurrence, parseCron } from "@/jobs/cron";

/** Contract of jobs.scheduled.turbineh: cron in the job's time zone, one identifiable occurrence per run. */
describe("scheduled jobs", () => {
  it("the shipped params are valid and reject a bad cron or time zone", () => {
    expect(scheduledConfig.jobs.length).toBeLessThanOrEqual(20);
    // An app may have no job of its own when another component only hands the route its tasks.
    expect(ScheduledParams.safeParse({ jobs: [], logWhenNoEmailProvider: true }).success).toBe(
      true,
    );
    const job = { id: "x", kind: "daily-digest", cron: "0 7 * * *", timeZone: "UTC", what: "w" };
    expect(ScheduledParams.safeParse({ jobs: [job], logWhenNoEmailProvider: true }).success).toBe(
      true,
    );
    for (const bad of [
      { cron: "0 25 * * *" },
      { cron: "every morning" },
      { timeZone: "Mars/Base" },
    ])
      expect(
        ScheduledParams.safeParse({ jobs: [{ ...job, ...bad }], logWhenNoEmailProvider: true })
          .success,
      ).toBe(false);
  });

  it("parses lists, ranges and steps; Sunday is 0 or 7", () => {
    const c = parseCron("*/15 9-17 * * 1-5,7");
    expect([...c.fields[0]!]).toEqual([0, 15, 30, 45]);
    expect(c.fields[1]!.has(17)).toBe(true);
    expect(c.fields[4]!.has(0)).toBe(true);
  });

  it("finds the latest scheduled time in the job's time zone, across daylight saving", () => {
    // Every morning at 07:00 Madrid: 05:00 UTC in summer, 06:00 UTC in winter.
    const summer = lastOccurrence("0 7 * * *", "Europe/Madrid", new Date("2026-10-13T12:00:00Z"));
    expect(summer?.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    const winter = lastOccurrence("0 7 * * *", "Europe/Madrid", new Date("2026-11-02T05:59:00Z"));
    expect(winter?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    // Weekdays only: Monday 08:00 is the latest before Sunday noon.
    const weekdays = lastOccurrence("0 8 * * 1-5", "UTC", new Date("2026-10-18T12:00:00Z"));
    expect(weekdays?.toISOString()).toBe("2026-10-16T08:00:00.000Z");
  });

  it("gives the same occurrence to every call until the next one is due (what makes runs idempotent)", () => {
    const a = lastOccurrence("0 7 * * *", "UTC", new Date("2026-10-13T07:00:30Z"));
    const b = lastOccurrence("0 7 * * *", "UTC", new Date("2026-10-14T06:59:00Z"));
    const c = lastOccurrence("0 7 * * *", "UTC", new Date("2026-10-14T07:00:00Z"));
    expect(a?.getTime()).toBe(b?.getTime());
    expect(c?.getTime()).not.toBe(a?.getTime());
  });
});

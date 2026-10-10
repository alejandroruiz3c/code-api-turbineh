import { describe, expect, it } from "vitest";
import { Cron } from "croner";
describe("croner contract", () => {
  it("evaluates next runs without starting", () => {
    const job = new Cron("0 9 * * *", { paused: true, timezone: "UTC" });
    expect(job.nextRun(new Date("2026-10-13T10:00:00Z"))?.toISOString()).toBe(
      "2026-10-14T09:00:00.000Z",
    );
    job.stop();
  });
});

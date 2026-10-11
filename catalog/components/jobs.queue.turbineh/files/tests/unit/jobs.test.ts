import { describe, expect, it, vi } from "vitest";

// The queue logic is tested without a database; the client module is replaced.
vi.mock("@/db/client", () => ({ db: {} }));

const { backoffMs, defineJob, isDefined } = await import("@/lib/jobs");
const { z } = await import("zod");

describe("jobs.queue.turbineh", () => {
  it("backs off exponentially and caps at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it("registers typed jobs and rejects unsafe type names", () => {
    defineJob("email.reminder", z.object({ to: z.email() }), async () => {});
    expect(isDefined("email.reminder")).toBe(true);
    expect(() => defineJob("DROP TABLE", z.object({}), async () => {})).toThrow(/invalid job type/);
  });
});

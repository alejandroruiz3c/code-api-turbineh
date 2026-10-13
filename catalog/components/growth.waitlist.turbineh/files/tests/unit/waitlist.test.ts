import { describe, expect, it } from "vitest";
import { WaitlistParams, waitlistConfig } from "@/waitlist/config";
import { positions } from "@/waitlist/rules";

/** Contract of growth.waitlist.turbineh: positions by confirmation time, moved up by confirmed referrals. */
const at = (min: number) => new Date(Date.UTC(2026, 9, 13, 10, min));
const queue = (refs: Record<string, number> = {}) =>
  ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, i) => ({
    id,
    confirmedAt: at(i),
    referrals: refs[id] ?? 0,
  }));

describe("waitlist positions", () => {
  it("the shipped params are valid", () => {
    expect(WaitlistParams.safeParse(waitlistConfig).success).toBe(true);
  });

  it("queues confirmed people by confirmation time", () => {
    const p = positions(queue(), 5);
    expect(["a", "b", "c", "h"].map((id) => p.get(id))).toEqual([1, 2, 3, 8]);
  });

  it("every confirmed referral moves the referrer up by the boost, never above first place", () => {
    // g is 7th; one referral with a boost of 5 → 2nd; two referrals → 1st (not above it).
    expect(positions(queue({ g: 1 }), 5).get("g")).toBe(2);
    expect(positions(queue({ g: 2 }), 5).get("g")).toBe(1);
    expect(positions(queue({ g: 1 }), 5).get("b")).toBe(3);
    // A boost of 0 ignores referrals.
    expect(positions(queue({ g: 3 }), 0).get("g")).toBe(7);
  });
});

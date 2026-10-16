import { describe, expect, it } from "vitest";
import { completion, history, streak, totalsByDay, weekTotal } from "@/server/streaks";

describe("tracker maths", () => {
  it("counts the streak up to today, or up to yesterday when today is still open", () => {
    const t = totalsByDay([
      { day: "2026-05-08", value: 1 },
      { day: "2026-05-09", value: 1 },
      { day: "2026-05-10", value: 1 },
    ]);
    expect(streak(t, 1, "2026-05-10")).toBe(3);
    expect(streak(t, 1, "2026-05-11")).toBe(3);
    expect(streak(t, 1, "2026-05-13")).toBe(0);
  });

  it("adds amounts exactly and compares with the daily goal", () => {
    const t = totalsByDay([
      { day: "2026-05-10", value: 0.1 },
      { day: "2026-05-10", value: 0.2 },
    ]);
    expect(t.get("2026-05-10")).toBe(0.3);
    expect(streak(t, 0.3, "2026-05-10")).toBe(1);
  });

  it("builds a 30-day history and the completion rate", () => {
    const h = history(totalsByDay([{ day: "2026-05-10", value: 2 }]), 1, "2026-05-10", 30);
    expect(h).toHaveLength(30);
    expect(h.at(-1)).toEqual({ day: "2026-05-10", total: 2, met: true });
    expect(completion(h)).toBe(3);
  });

  it("the weekly total adds up exactly the last 7 days of logs, not older ones", () => {
    const h = history(
      totalsByDay([
        { day: "2026-05-10", value: 0.1 },
        { day: "2026-05-04", value: 0.2 },
        { day: "2026-05-03", value: 5 },
      ]),
      1,
      "2026-05-10",
      30,
    );
    expect(weekTotal(h), "the weekly total counts 05-04 to 05-10 and leaves out 05-03").toBe(0.3);
  });
});

import { describe, expect, it } from "vitest";
import pLimit from "p-limit";
describe("p-limit contract", () => {
  it("never exceeds the concurrency limit", async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});

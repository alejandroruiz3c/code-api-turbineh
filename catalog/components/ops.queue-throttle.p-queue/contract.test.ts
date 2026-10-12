import { describe, expect, it } from "vitest";
import PQueue from "p-queue";
describe("p-queue contract", () => {
  it("limits concurrency for batch work", async () => {
    const queue = new PQueue({ concurrency: 2 });
    let running = 0;
    let max = 0;
    const job = async (n: number) => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n * 2;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => queue.add(() => job(n))));
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(max).toBe(2);
  });

  it("caps requests per interval", async () => {
    const queue = new PQueue({ intervalCap: 2, interval: 200 });
    const t0 = Date.now();
    await Promise.all([1, 2, 3].map(() => queue.add(async () => Date.now() - t0)));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });
});

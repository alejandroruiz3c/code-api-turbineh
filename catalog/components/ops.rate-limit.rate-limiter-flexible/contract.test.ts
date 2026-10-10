import { describe, expect, it } from "vitest";
import { RateLimiterMemory } from "rate-limiter-flexible";
describe("rate-limiter-flexible contract", () => {
  it("consumes points and rejects over the limit", async () => {
    const rl = new RateLimiterMemory({ points: 2, duration: 60 });
    await rl.consume("ip");
    await rl.consume("ip");
    await expect(rl.consume("ip")).rejects.toHaveProperty("remainingPoints", 0);
  });
});

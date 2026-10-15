import { describe, expect, it } from "vitest";
import pRetry from "p-retry";
describe("p-retry contract", () => {
  it("retries until success", async () => {
    let n = 0;
    const r = await pRetry(
      async () => {
        n++;
        if (n < 3) throw new Error("x");
        return "ok";
      },
      { retries: 3, minTimeout: 1, factor: 1 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
});

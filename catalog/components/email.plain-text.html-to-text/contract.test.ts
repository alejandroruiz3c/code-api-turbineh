import { describe, expect, it } from "vitest";
import { convert } from "html-to-text";
describe("html-to-text contract", () => {
  it("turns an HTML email into readable plain text", () => {
    expect(
      convert("<h1>Order confirmed</h1><p>Total: <b>€20</b></p>", { wordwrap: false }),
    ).toContain("Total: €20");
  });
});

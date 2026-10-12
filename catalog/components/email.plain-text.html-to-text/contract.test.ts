import { describe, expect, it } from "vitest";
import { convert } from "html-to-text";
describe("html-to-text contract", () => {
  it("turns an HTML email into readable plain text", () => {
    expect(
      convert("<h1>Order confirmed</h1><p>Total: <b>€20</b></p>", { wordwrap: false }),
    ).toContain("Total: €20");
  });

  it("skips images, keeps link targets once and wraps lines (options used by the curated glue)", () => {
    const text = convert(
      '<p><img src="logo.png" alt="Logo">Track it <a href="https://x.test/o/1">here</a> or ' +
        '<a href="https://x.test">https://x.test</a>. ' +
        "word ".repeat(40) +
        "</p>",
      {
        wordwrap: 78,
        selectors: [
          { selector: "img", format: "skip" },
          { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
        ],
      },
    );
    expect(text).not.toContain("Logo");
    expect(text).toContain("here [https://x.test/o/1]");
    expect(text.match(/https:\/\/x\.test\b(?!\/)/g)?.length).toBe(1);
    expect(Math.max(...text.split("\n").map((l) => l.length))).toBeLessThanOrEqual(78);
  });
});

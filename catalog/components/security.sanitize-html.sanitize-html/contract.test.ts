import { describe, expect, it } from "vitest";
import sanitizeHtml from "sanitize-html";
describe("sanitize-html contract", () => {
  it("strips scripts and event handlers", () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi<script>alert(1)</script><a href="javascript:x">l</a></p>',
    );
    expect(out).toBe("<p>hi<a>l</a></p>");
  });
});

import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
describe("linkedom contract", () => {
  it("parses HTML into a queryable DOM on the server", () => {
    const { document } = parseHTML(
      '<ul><li class="item">A</li><li class="item">B</li></ul><script>alert(1)</script>',
    );
    expect([...document.querySelectorAll(".item")].map((n) => n.textContent)).toEqual(["A", "B"]);
    expect(document.querySelector("script")?.textContent).toBe("alert(1)");
  });
});

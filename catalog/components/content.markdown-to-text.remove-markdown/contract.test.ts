import { describe, expect, it } from "vitest";
import removeMd from "remove-markdown";
describe("remove-markdown contract", () => {
  it("turns Markdown into plain text", () => {
    expect(removeMd("# Status\n\nYour order **o-42** is [shipped](https://x.test).").trim()).toBe(
      "Status\n\nYour order o-42 is shipped.",
    );
  });
});

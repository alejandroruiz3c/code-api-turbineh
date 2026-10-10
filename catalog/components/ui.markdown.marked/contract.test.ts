import { describe, expect, it } from "vitest";
import { marked } from "marked";
describe("marked contract", () => {
  it("renders markdown to html", async () => {
    expect(await marked.parse("# Title\n\n**bold**")).toContain("<strong>bold</strong>");
  });
});

import { describe, expect, it } from "vitest";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
describe("@mozilla/readability contract", () => {
  it("extracts the main article from a page, without navigation", () => {
    const body =
      "<p>" +
      "Solar panels on schools cut energy bills by a third in the pilot. ".repeat(12) +
      "</p>";
    const { document } = parseHTML(
      `<html><head><title>Pilot results</title></head><body><nav>Home | About | Contact</nav><article><h1>Pilot results</h1>${body}</article><footer>Cookie settings</footer></body></html>`,
    );
    const article = new Readability(document as unknown as Document).parse();
    expect(article?.textContent).toContain("Solar panels on schools");
    expect(article?.textContent).not.toContain("Cookie settings");
  });
});

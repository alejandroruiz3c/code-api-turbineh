import { describe, expect, it } from "vitest";
import he from "he";
describe("he contract", () => {
  it("escapes and decodes entities", () => {
    expect(he.escape("<a href='x'>&</a>")).toBe("&lt;a href=&#x27;x&#x27;&gt;&amp;&lt;/a&gt;");
    expect(he.decode("&eacute;&amp;")).toBe("é&");
  });
});

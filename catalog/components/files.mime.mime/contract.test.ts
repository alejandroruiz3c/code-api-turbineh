import { describe, expect, it } from "vitest";
import mime from "mime";
describe("mime contract", () => {
  it("maps extensions and types", () => {
    expect(mime.getType("report.pdf")).toBe("application/pdf");
    expect(mime.getExtension("text/csv")).toBe("csv");
  });
});

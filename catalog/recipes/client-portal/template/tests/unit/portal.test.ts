import { describe, expect, it } from "vitest";
import { canTransition, safeFileName, sniffType } from "@/server/portal";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("client portal rules", () => {
  it("lets only owners and admins move a request along allowed transitions", () => {
    expect(canTransition("admin", "submitted", "in_review")).toBe(true);
    expect(canTransition("member", "submitted", "in_review")).toBe(false);
    expect(canTransition("owner", "completed", "in_review")).toBe(false);
  });

  it("detects file types from content, not from the name", () => {
    expect(sniffType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffType(new TextEncoder().encode("hello, world\n"))).toBe("text/plain");
  });

  it("rejects HTML, SVG and binaries", () => {
    expect(sniffType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(
      sniffType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(sniffType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });

  it("strips paths and unsafe characters from file names", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName('report"; rm -rf.pdf')).toBe("report_ rm -rf.pdf");
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instructionFile } from "./agent-docs.js";

const dir = (files: string[] = []) => {
  const d = mkdtempSync(join(tmpdir(), "agent-docs-"));
  for (const f of files) writeFileSync(join(d, f), "# notes\n");
  return d;
};

describe("instruction file (agent-neutral)", () => {
  it("defaults to AGENTS.md, which most coding agents read", () => {
    expect(instructionFile(dir(), null)).toBe("AGENTS.md");
  });
  it("uses the file the agent reads when it is named", () => {
    expect(instructionFile(dir(), "claude")).toBe("CLAUDE.md");
    expect(instructionFile(dir(), "codex")).toBe("AGENTS.md");
    expect(instructionFile(dir(), "cursor")).toBe("AGENTS.md");
  });
  it("reuses an existing instructions file, AGENTS.md first", () => {
    expect(instructionFile(dir(["CLAUDE.md"]), null)).toBe("CLAUDE.md");
    expect(instructionFile(dir(["AGENTS.md", "CLAUDE.md"]), null)).toBe("AGENTS.md");
  });
});

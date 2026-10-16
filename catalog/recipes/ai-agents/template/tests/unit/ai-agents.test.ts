import { describe, expect, it } from "vitest";
// turbineh:module knowledge-base
import { chunkText } from "@/server/chunking";
// turbineh:end-module knowledge-base
// turbineh:module batch-processes
import { outputText, parseLabels, schemaFor } from "@/server/process-schema";
// turbineh:end-module batch-processes
import { isTool, TOOL_REGISTRY } from "@/server/tools";

describe("recipe ai-agents", () => {
  // turbineh:module knowledge-base
  it("splits documents into overlapping passages on paragraph boundaries", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`).join(
      "\n\n",
    );
    const parts = chunkText(text, 500, 80);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 500 + 80)).toBe(true);
    expect(chunkText("Short note.")).toEqual(["Short note."]);
  });

  // turbineh:end-module knowledge-base

  // turbineh:module batch-processes
  it("validates labels and structured outputs of processes", () => {
    expect(parseLabels("billing, bug ,billing,Other")).toEqual(["billing", "bug", "Other"]);
    expect(parseLabels("only-one")).toEqual([]);
    const classify = schemaFor("classify", ["billing", "bug"]);
    expect(classify.safeParse({ label: "bug" }).success).toBe(true);
    expect(classify.safeParse({ label: "spam" }).success).toBe(false);
    expect(outputText("extract", { data: { order: "A-1", amount: "20" } })).toBe(
      "order: A-1; amount: 20",
    );
  });

  // turbineh:end-module batch-processes

  it("only knows registry tools; sending email is irreversible", () => {
    expect(isTool("email_me")).toBe(true);
    expect(isTool("rm_rf")).toBe(false);
    expect(TOOL_REGISTRY.find((t) => t.name === "email_me")?.irreversible).toBe(true);
  });
});

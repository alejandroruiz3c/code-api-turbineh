import { describe, expect, it } from "vitest";
import { chunkText } from "@/server/chunking";
import { outputText, parseLabels, schemaFor } from "@/server/process-schema";
import { isTool, TOOL_REGISTRY } from "@/server/tools";

describe("recipe ai-agents", () => {
  it("splits documents into overlapping passages on paragraph boundaries", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`).join(
      "\n\n",
    );
    const parts = chunkText(text, 500, 80);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 500 + 80)).toBe(true);
    expect(chunkText("Short note.")).toEqual(["Short note."]);
  });

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

  it("only knows registry tools; sending email is irreversible", () => {
    expect(isTool("email_me")).toBe(true);
    expect(isTool("rm_rf")).toBe(false);
    expect(TOOL_REGISTRY.find((t) => t.name === "email_me")?.irreversible).toBe(true);
  });
});

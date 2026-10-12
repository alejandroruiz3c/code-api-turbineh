import { z } from "zod";

export const PROCESS_KINDS = ["classify", "extract", "summarize"] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];
export const isKind = (v: string): v is ProcessKind =>
  (PROCESS_KINDS as readonly string[]).includes(v);

/** "billing, bug ,Other" → ["billing", "bug", "Other"] (unique, 2–20 labels of up to 40 characters). */
export function parseLabels(input: string): string[] {
  const labels = [
    ...new Set(
      input
        .split(/[,\n]/)
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
  if (labels.length < 2 || labels.length > 20 || labels.some((l) => l.length > 40)) return [];
  return labels;
}

/** What a processed item can return (one of the three shapes below). */
export type ProcessOutput = { label?: string; summary?: string; data?: Record<string, string> };

/** Structured output each kind must return; validated by the orchestrator before it is stored. */
export function schemaFor(kind: ProcessKind, labels: readonly string[]): z.ZodType<ProcessOutput> {
  if (kind === "classify") {
    const [first, ...rest] = labels;
    if (!first) throw new Error("classification needs labels");
    return z.object({ label: z.enum([first, ...rest] as [string, ...string[]]) });
  }
  if (kind === "summarize") return z.object({ summary: z.string().min(1).max(600) });
  return z.object({ data: z.record(z.string().max(60), z.string().max(400)) });
}

/** One line shown in the results table and in the CSV export. */
export function outputText(kind: ProcessKind, value: unknown): string {
  const v = value as { label?: string; summary?: string; data?: Record<string, string> };
  if (kind === "classify") return v.label ?? "";
  if (kind === "summarize") return v.summary ?? "";
  return Object.entries(v.data ?? {})
    .map(([k, val]) => `${k}: ${val}`)
    .join("; ");
}

export const PROCESS_TASKS: Record<ProcessKind, string> = {
  classify: "Classify the record into exactly one of the allowed labels.",
  extract: "Extract the requested fields from the record as short key/value pairs.",
  summarize: "Summarise the record in at most three sentences.",
};

import { z } from "zod";
import type { ToolSpec } from "@/lib/ai/guard";
import { GENERATED_READ_TOOLS } from "@/server/agent-tools";

/**
 * Tools an assistant may be given (recipe ai-agents). Admins enable them per assistant; the decider chooses one per
 * turn; irreversible ones wait for the user's confirmation (AI Safety Pack). The model never runs code directly:
 * read-only tools run here, tenant-scoped, with zod-validated parameters taken from the user's message.
 */
export interface ReadToolContext {
  organizationId: string;
  userId: string;
}

export interface ReadTool<P extends z.ZodType = z.ZodType> {
  spec: ToolSpec;
  label: string;
  params: P;
  /** Parameters from the user's message (deterministic); null when the message carries none. */
  argsFrom: (text: string) => unknown;
  /** Read-only and scoped to the organization; returns the text the assistant relays (including "not found"). */
  run: (ctx: ReadToolContext, args: z.infer<P>) => Promise<string>;
}

export const READ_TOOLS: readonly ReadTool[] = GENERATED_READ_TOOLS;

export const TOOL_REGISTRY: readonly ToolSpec[] = [
  {
    name: "escalate_to_human",
    description: "Flag the conversation and email the team (ADMIN_EMAILS) so a person follows up.",
    irreversible: false,
  },
  {
    name: "email_me",
    description: "Send the answer to the signed-in user's email address.",
    irreversible: true,
  },
  ...READ_TOOLS.map((t) => t.spec),
];

export const TOOL_LABELS: Record<string, string> = {
  escalate_to_human: "Escalate to a person (emails the team)",
  email_me: "Email the answer to me (asks first)",
  ...Object.fromEntries(READ_TOOLS.map((t) => [t.spec.name, t.label])),
};

export const isTool = (name: string) => TOOL_REGISTRY.some((t) => t.name === name);

/** Runs a read-only tool chosen by the decider. Missing/invalid parameters come back as a message, never a throw. */
export async function runReadTool(
  name: string,
  ctx: ReadToolContext,
  text: string,
): Promise<string | null> {
  const tool = READ_TOOLS.find((t) => t.spec.name === name);
  if (!tool) return null;
  const parsed = tool.params.safeParse(tool.argsFrom(text));
  if (!parsed.success) return `I need more details to use ${tool.label.toLowerCase()}.`;
  return tool.run(ctx, parsed.data);
}

/** Team addresses for escalations (ADMIN_EMAILS). Empty = escalation by email is not configured. */
export const teamEmails = (list = process.env.ADMIN_EMAILS ?? "") =>
  list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));

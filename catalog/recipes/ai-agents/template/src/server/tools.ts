import type { ToolSpec } from "@/lib/ai/guard";

/**
 * Tools an assistant may be given (recipe ai-agents). Admins enable them per assistant; the decider chooses one per
 * turn; irreversible ones wait for the user's confirmation (AI Safety Pack). The model never runs code directly.
 */
export const TOOL_REGISTRY: readonly ToolSpec[] = [
  {
    name: "escalate_to_human",
    description: "Flag the conversation so a person from the team follows up.",
    irreversible: false,
  },
  {
    name: "email_me",
    description: "Send the answer to the signed-in user's email address.",
    irreversible: true,
  },
];

export const TOOL_LABELS: Record<string, string> = {
  escalate_to_human: "Escalate to a person",
  email_me: "Email the answer to me (asks first)",
};

export const isTool = (name: string) => TOOL_REGISTRY.some((t) => t.name === name);

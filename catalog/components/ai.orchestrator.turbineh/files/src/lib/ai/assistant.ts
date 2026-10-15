import { z } from "zod";
import type { AnyAgentTool, Toolkit } from "./agent";
import { TOOLKITS } from "./toolkits";

/**
 * The public assistant (ADR-0033): end users without an account talk to the toolkits whose audience is "public".
 * Limits on top of the AI Safety Pack: short messages, requests per minute per IP, turns per conversation.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  AI_PUBLIC_MAX_INPUT_CHARS: z.preprocess(
    empty,
    z.coerce.number().int().min(50).max(8000).default(1000),
  ),
  AI_PUBLIC_REQUESTS_PER_MINUTE: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(600).default(10),
  ),
  AI_PUBLIC_TURNS_PER_CONVERSATION: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(500).default(60),
  ),
});
export const publicAssistantConfig = () => Env.parse(process.env);

export const PUBLIC_PURPOSE = "public-assistant";

export function publicToolkits(all: readonly Toolkit[] = TOOLKITS): Toolkit[] {
  return all.filter((t) => t.audience === "public");
}

/** Instructions and tools of every public toolkit (tool names must be unique across toolkits). */
export function publicAssistant(all: readonly Toolkit[] = TOOLKITS): {
  enabled: boolean;
  title: string;
  greeting: string;
  instructions: string;
  tools: AnyAgentTool[];
} {
  const kits = publicToolkits(all);
  const seen = new Set<string>();
  const tools = kits.flatMap((k) => k.tools).filter((t) => !seen.has(t.name) && seen.add(t.name));
  return {
    enabled: kits.length > 0,
    title: kits[0]?.title ?? "Assistant",
    greeting:
      kits
        .map((k) => k.greeting)
        .filter(Boolean)
        .join(" ") || "Hi! How can I help?",
    instructions: kits.map((k) => k.instructions).join("\n\n"),
    tools,
  };
}

/**
 * Client IP for rate limiting: only the X-Forwarded-For entry of a trusted proxy (Security Pack,
 * src/security/client-ip.ts, ADR-0054), never what the client prepends.
 */
export { clientIp } from "@/security/client-ip";

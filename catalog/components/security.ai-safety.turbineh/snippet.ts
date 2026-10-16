// Server code in the app around any model call (src/lib/ai/* already does this for the orchestrator).
import { guardInput, redactPii, scanOutput } from "@/lib/ai/guard";

export async function safeAsk(userInput: string, ask: (prompt: string) => Promise<string>) {
  const input = guardInput(userInput); // throws AiSafetyError on injection attempts or oversize input
  const answer = await ask(input.text);
  const output = scanOutput(answer); // secrets always redacted; personal data when AI_REDACT_PII=true
  return { text: output.text, flags: [...input.flags, ...output.flags] };
}

export const redacted = redactPii("Write to ana@example.com or call +34 600 000 000"); // → "[email]", "[phone]"

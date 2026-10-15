import { z } from "zod";
import { UserFacingError } from "@/security/errors";

/**
 * AI Safety Pack · pure guards (component security.ai-safety.turbineh, ADR-0028). Always installed with the
 * orchestrator; there is no switch to turn it off. Messages are safe to show: they never echo internals.
 */
export class AiSafetyError extends UserFacingError {}

const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  AI_MAX_INPUT_CHARS: z.preprocess(
    empty,
    z.coerce.number().int().min(1000).max(200_000).default(20_000),
  ),
  AI_REDACT_PII: z.preprocess(empty, z.enum(["true", "false"]).default("false")),
});
let cached: z.infer<typeof Env> | undefined;
export const guardConfig = () => (cached ??= Env.parse(process.env));

/** Known prompt-injection phrasings and chat-template control tokens. */
const INJECTION: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|messages)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|system)\b/i,
  /(reveal|show|print|repeat|output)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions|rules)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|developer\s+mode|jailbroken|unrestricted)/i,
  /\bjailbreak\b/i,
  /pretend\s+(that\s+)?you\s+(have|are)\s+(no|without)\s+(rules|restrictions|limits)/i,
  /<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>/i,
  /\[\/?(system|inst)\]/i,
  /begin\s+system\s+prompt/i,
];
const CONTROL_TOKENS = /<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>|\[\/?(system|inst)\]/gi;

export const looksLikeInjection = (text: string) => INJECTION.some((re) => re.test(text));

export interface Guarded {
  text: string;
  flags: string[];
}

/**
 * Checks text before it reaches a model. A user's request that tries to override the instructions is refused; a
 * document (knowledge base, imported record) is data: control tokens are removed and the text is kept.
 */
export function guardInput(raw: string, kind: "request" | "document" = "request"): Guarded {
  const cfg = guardConfig();
  const flags: string[] = [];
  // Control characters (except tab and new line) have no place in prompts.
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length === 0) throw new AiSafetyError("Please write something first.");
  if (text.length > cfg.AI_MAX_INPUT_CHARS) {
    throw new AiSafetyError(`This text is too long (max ${cfg.AI_MAX_INPUT_CHARS} characters).`);
  }
  if (looksLikeInjection(text)) {
    if (kind === "request")
      throw new AiSafetyError("This request can't be processed. Please rephrase it.");
    text = text.replace(CONTROL_TOKENS, " ");
    flags.push("injection-neutralized");
  }
  if (cfg.AI_REDACT_PII === "true") {
    const redacted = redactPii(text);
    if (redacted !== text) flags.push("pii-redacted");
    text = redacted;
  }
  return { text, flags };
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Emails, IBANs, payment cards (Luhn-checked) and phone numbers → placeholders. */
export function redactPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, "[iban]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m))
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));
}

/** Credential formats that must never leave the app in a model's answer. */
const SECRETS: RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** Checks a model's answer before it is shown or stored: secrets always, personal data when configured. */
export function scanOutput(raw: string): Guarded {
  const flags: string[] = [];
  let text = raw;
  for (const re of SECRETS) text = text.replace(re, "[redacted secret]");
  if (text !== raw) flags.push("secret-redacted");
  if (guardConfig().AI_REDACT_PII === "true") {
    const redacted = redactPii(text);
    if (redacted !== text) flags.push("pii-redacted");
    text = redacted;
  }
  return { text, flags };
}

/** A tool the assistant may use. Irreversible tools (sending, paying, deleting) need a person to confirm. */
export interface ToolSpec {
  name: string;
  description: string;
  irreversible: boolean;
}

/** Only tools an admin enabled for this assistant, from the app's own registry (never from the model). */
export function allowedTools(
  registry: readonly ToolSpec[],
  enabled: readonly string[],
): ToolSpec[] {
  const on = new Set(enabled);
  return registry.filter((t) => on.has(t.name) && /^[a-z][a-z0-9_]{1,40}$/.test(t.name));
}

export const needsConfirmation = (tool: ToolSpec) => tool.irreversible;

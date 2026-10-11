import OpenAI from "openai";
import { z } from "zod";

/** An OpenAI-compatible endpoint serving an open-weights model. */
export interface ModelCfg {
  baseURL: string;
  apiKey?: string;
  model: string;
  reasoningEffort?: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

const FileOut = z.object({ content: z.string().min(1) });

/** The app's compiler and lint rules, given to every code-writing call so the first attempt passes more often. */
export const CODE_RULES =
  "TypeScript strict with noUncheckedIndexedAccess and isolatedModules: use `import type` for type-only imports, " +
  "handle possibly-undefined array/record access, no `any`, no unused variables or imports, no non-null assertions " +
  "on user data. React 19: there is no global JSX namespace (use React.ReactElement or omit return types). " +
  "Tests: import every vitest helper you use (describe, it, expect, vi). " +
  "Never write literals that look like API keys, tokens, passwords or long random strings, not even in tests: " +
  "use short obvious fakes such as 'key-1' or 'test-token'. " +
  "ESLint: typescript-eslint recommended + Next.js core-web-vitals + react-hooks.";

/** One small task → one whole file. JSON output keeps the reply machine-checkable (ADR-0010). */
export async function askFile(
  cfg: ModelCfg,
  system: string,
  payload: unknown,
  maxTokens = 4000,
): Promise<{ content: string; usage: Usage }> {
  const client = new OpenAI({
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey ?? "none",
    timeout: 120_000,
    maxRetries: 1,
  });
  const res = await client.chat.completions.create({
    model: cfg.model,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${system}\n${CODE_RULES}\nReturn JSON only: {"content": "<the full file>"}.`,
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
    ...(cfg.reasoningEffort
      ? { reasoning_effort: cfg.reasoningEffort as OpenAI.ReasoningEffort }
      : {}),
  });
  const content = FileOut.parse(JSON.parse(res.choices[0]?.message.content ?? "{}")).content;
  return {
    content: stripFences(content),
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

export function stripFences(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

/** Removes leading `// turbineh:...` header lines so a new header can be written exactly once. */
export function withoutTurbinehHeader(code: string): string {
  const lines = code.split("\n");
  while (lines[0]?.startsWith("// turbineh:")) lines.shift();
  return lines.join("\n");
}

/** Keeps a `"use client"` / `"use server"` directive as the first statement, after the header comment. */
export function withHeader(header: string, code: string): string {
  const body = withoutTurbinehHeader(code).trimStart();
  return `${header}\n${body.trimEnd()}\n`;
}

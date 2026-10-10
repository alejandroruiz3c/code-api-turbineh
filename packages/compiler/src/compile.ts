import OpenAI from "openai";
import {
  buildSpecJsonSchema,
  buildSpecSchema,
  CAPABILITIES,
  RECIPES,
  type BuildSpec,
} from "./build-spec.js";

export interface CompilerConfig {
  /** Any OpenAI-compatible endpoint serving an open-weights model (local Ollama by default). */
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Validation retries with the error fed back (PLAN §2.2: max 2, then Backup Coder via T5). */
  maxRetries?: number;
}

export interface CompileResult {
  ok: boolean;
  spec?: BuildSpec;
  attempts: number;
  latencyMs: number;
  usage: { input_tokens: number; output_tokens: number };
  errors: string[];
  /** True when the caller must escalate to the Backup Coder (trigger T5). */
  escalate: boolean;
}

const SYSTEM = `You are the intent compiler of a software generator. Convert the user's prompt into a BuildSpec JSON object.
Rules:
- recipe must be one of: ${RECIPES.join(", ")}. If the prompt is not a web app of one of these families, use "out_of_scope", explain why in out_of_scope_reason and set closest_recipe.
- Otherwise set out_of_scope_reason and closest_recipe to null.
- capabilities: only ids from this list: ${CAPABILITIES.join(", ")}. Always include security.headers and data.validation.
- No AI features in the generated app (blocked in the beta).
- acceptance_criteria: concrete, testable statements (3–15).
- Output only the JSON object.`;

export async function compileIntent(
  prompt: string,
  config: CompilerConfig,
): Promise<CompileResult> {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey ?? "local" });
  const maxRetries = config.maxRetries ?? 2;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const errors: string[] = [];
  const start = performance.now();

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const res = await client.chat.completions.create({
      model: config.model,
      temperature: 0,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "BuildSpec",
          schema: buildSpecJsonSchema as Record<string, unknown>,
          strict: true,
        },
      },
    });
    usage.input_tokens += res.usage?.prompt_tokens ?? 0;
    usage.output_tokens += res.usage?.completion_tokens ?? 0;
    const content = res.choices[0]?.message.content ?? "";

    let error: string;
    try {
      const parsed = buildSpecSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        return {
          ok: true,
          spec: parsed.data,
          attempts: attempt,
          latencyMs: Math.round(performance.now() - start),
          usage,
          errors,
          escalate: false,
        };
      }
      error = parsed.error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`).join("; ");
    } catch (err) {
      error = `invalid JSON: ${(err as Error).message}`;
    }
    errors.push(error);
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `The JSON is invalid: ${error}. Return the corrected BuildSpec JSON only.`,
      },
    );
  }

  return {
    ok: false,
    attempts: maxRetries + 1,
    latencyMs: Math.round(performance.now() - start),
    usage,
    errors,
    escalate: true,
  };
}

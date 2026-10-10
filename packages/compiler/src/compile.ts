import { choice, noul, type Decider } from "@turbineh/decider";
import OpenAI from "openai";
import { z } from "zod";
import { buildSpecSchema, type BuildSpec } from "./build-spec.js";
import {
  ALWAYS_ON,
  CAPABILITY_QUESTIONS,
  PARTS,
  RECIPE_DESCRIPTIONS,
  type PartName,
} from "./parts.js";

export interface CompilerConfig {
  /** Any OpenAI-compatible endpoint serving an open-weights model. */
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Validation retries per part with the error fed back (PLAN §2.2: max 2, then Backup Coder via T5). */
  maxRetries?: number;
  /** e.g. "none" to disable thinking (faster, no reasoning tokens). */
  reasoningEffort?: string;
  /** Hard cap on output tokens per part attempt, so a degenerate generation can never run for minutes. */
  maxOutputTokens?: number;
}

/** Decider thresholds live in code (per decision point). */
// Calibration v1 (2026-10-10, from build traces): 0.5 admitted styling/dialog/retry noise; recalibrate with the D2 benchmark.
export const CAPABILITY_THRESHOLD = 0.6;

export interface CompileDecisions {
  recipe: { choice: string; confidence: number; probabilities: Record<string, number> };
  capabilities: Record<string, number>;
  deciderModel: string;
  deciderLatencyMs: number;
}

export interface CompileResult {
  ok: boolean;
  spec?: BuildSpec;
  decisions?: CompileDecisions;
  attempts: Record<PartName, number>;
  latencyMs: number;
  usage: { input_tokens: number; output_tokens: number };
  errors: string[];
  /** True when the caller must escalate to the Backup Coder (trigger T5). */
  escalate: boolean;
}

const SYSTEM =
  "You write one small part of a web app specification. Answer with JSON only, matching the schema. Be concise.";

/**
 * Prompt → BuildSpec, decomposed:
 *  1. Decider: recipe (one Choice) + one atomic Noul per capability — a single batched request.
 *  2. Small open model: four small structured parts (meta, entities, pages, criteria) in parallel.
 *  3. Code: deterministic assembly, always-on capabilities, final validation.
 */
export async function compileIntent(
  prompt: string,
  config: CompilerConfig,
  decider: Decider,
): Promise<CompileResult> {
  const start = performance.now();
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey ?? "local",
    timeout: 60_000,
    maxRetries: 1,
  });
  const usage = { input_tokens: 0, output_tokens: 0 };
  const errors: string[] = [];
  const attempts = { meta: 0, entities: 0, pages: 0, criteria: 0 } as Record<PartName, number>;

  const [decisions, ...parts] = await Promise.all([
    decide(prompt, decider),
    ...(Object.keys(PARTS) as PartName[]).map((name) =>
      generatePart(client, config, prompt, name, usage, attempts, errors),
    ),
  ]);

  const latencyMs = Math.round(performance.now() - start);
  if (parts.some((p) => p === undefined)) {
    return { ok: false, decisions, attempts, latencyMs, usage, errors, escalate: true };
  }

  const [meta, entities, pages, criteria] = parts as [
    z.infer<typeof PARTS.meta.schema>,
    z.infer<typeof PARTS.entities.schema>,
    z.infer<typeof PARTS.pages.schema>,
    z.infer<typeof PARTS.criteria.schema>,
  ];
  const outOfScope = decisions.recipe.choice === "out_of_scope";
  const closest = Object.entries(decisions.recipe.probabilities)
    .filter(([k]) => k !== "out_of_scope")
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  const capabilities = [
    ...ALWAYS_ON,
    ...Object.entries(decisions.capabilities)
      .filter(([, p]) => p >= CAPABILITY_THRESHOLD)
      .map(([id]) => id),
  ];

  const parsed = buildSpecSchema.safeParse({
    recipe: decisions.recipe.choice,
    out_of_scope_reason: outOfScope ? "The prompt does not match any beta recipe." : null,
    closest_recipe: outOfScope ? (closest ?? null) : null,
    ...meta,
    ...entities,
    ...pages,
    capabilities,
    ...criteria,
  });
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`));
    return { ok: false, decisions, attempts, latencyMs, usage, errors, escalate: true };
  }
  return {
    ok: true,
    spec: parsed.data,
    decisions,
    attempts,
    latencyMs,
    usage,
    errors,
    escalate: false,
  };
}

async function decide(prompt: string, decider: Decider): Promise<CompileDecisions> {
  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
    recipe: choice(
      "Which product family best matches the app described in `prompt`?",
      RECIPE_DESCRIPTIONS,
      { includeNone: false },
    ),
  };
  for (const [id, text] of Object.entries(CAPABILITY_QUESTIONS)) {
    questions[`cap:${id}`] = noul(`For the app described in \`prompt\`: ${text}`);
  }
  const d = await decider.ask({ prompt }, questions);
  const recipe = d.answers.recipe;
  if (recipe?.type !== "choice") throw new Error("decider returned no recipe choice");
  const capabilities: Record<string, number> = {};
  for (const [key, a] of Object.entries(d.answers)) {
    if (key.startsWith("cap:") && a.type === "noul") capabilities[key.slice(4)] = a.noul;
  }
  return {
    recipe: {
      choice: recipe.choice,
      confidence: recipe.confidence,
      probabilities: { ...recipe.probabilities },
    },
    capabilities,
    deciderModel: d.meta.model,
    deciderLatencyMs: d.meta.latencyMs,
  };
}

async function generatePart(
  client: OpenAI,
  config: CompilerConfig,
  prompt: string,
  name: PartName,
  usage: CompileResult["usage"],
  attempts: Record<PartName, number>,
  errors: string[],
): Promise<unknown> {
  const { schema, instruction } = PARTS[name];
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<
    string,
    unknown
  >;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `${instruction}\n\nApp description:\n${prompt}` },
  ];
  const maxRetries = config.maxRetries ?? 2;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts[name] = attempt;
    const res = await client.chat.completions.create({
      model: config.model,
      temperature: 0,
      max_tokens: config.maxOutputTokens ?? 1500,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name, schema: jsonSchema, strict: true },
      },
      ...(config.reasoningEffort
        ? { reasoning_effort: config.reasoningEffort as OpenAI.ReasoningEffort }
        : {}),
    });
    usage.input_tokens += res.usage?.prompt_tokens ?? 0;
    usage.output_tokens += res.usage?.completion_tokens ?? 0;
    const content = res.choices[0]?.message.content ?? "";
    let error: string;
    try {
      const parsed = schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
      error = parsed.error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`).join("; ");
    } catch (err) {
      error = `invalid JSON: ${(err as Error).message}`;
    }
    errors.push(`${name}#${attempt}: ${error}`);
    messages.push(
      { role: "assistant", content },
      { role: "user", content: `Invalid: ${error}. Return the corrected JSON only.` },
    );
  }
  return undefined;
}

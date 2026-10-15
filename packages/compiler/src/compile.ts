import type { Decider, IntentDecisions } from "@turbineh/decider";
import OpenAI from "openai";
import { z } from "zod";
import { buildSpecSchema, type BuildSpec } from "./build-spec.js";
import { extractPalette } from "./palette.js";
import { separateNonFunctional, type NonFunctionalRequirement } from "./non-functional.js";
import {
  ALWAYS_ON,
  OPTIONAL_PARTS,
  PARTS,
  PUBLIC_SITE_RECIPES,
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

/** Decisions about the request (product family, capabilities, Abuse Guard), from the resource decision engine. */
export type CompileDecisions = IntentDecisions;

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
  /** Set when the Abuse Guard rejects the prompt (never escalated). */
  rejected?: string;
  /** Non-functional requirements the model proposed as entities, removed and mapped to capabilities (ADR-0037). */
  nonFunctional?: NonFunctionalRequirement[];
}

const SYSTEM =
  "You write one small part of a web app specification. Answer with JSON only, matching the schema. Be concise.";

/**
 * Prompt → BuildSpec, decomposed:
 *  1. Decider (resource decision engine, ADR-0058): product family, optional capabilities and Abuse Guard.
 *  2. Small open model: four small structured parts (meta, entities, pages, criteria) in parallel.
 *  3. Code: deterministic assembly, always-on capabilities, final validation.
 */
export async function compileIntent(
  prompt: string,
  config: CompilerConfig,
  decider: Pick<Decider, "classifyIntent">,
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
  const attempts = { meta: 0, entities: 0, pages: 0, criteria: 0, site: 0 } as Record<
    PartName,
    number
  >;

  // Optional parts run in parallel too, but the build only waits for them when the recipe needs them.
  const required = (Object.keys(PARTS) as PartName[]).filter((n) => !OPTIONAL_PARTS.includes(n));
  const sitePromise = generatePart(client, config, prompt, "site", usage, attempts, errors).catch(
    () => undefined,
  );
  const [intent, ...requiredParts] = await Promise.all([
    decider.classifyIntent({ prompt, recipes: RECIPE_DESCRIPTIONS }),
    ...required.map((name) => generatePart(client, config, prompt, name, usage, attempts, errors)),
  ]);
  const decisions = intent.decisions;
  const publicSite = (PUBLIC_SITE_RECIPES as readonly string[]).includes(decisions.recipe.choice);
  const parts = [...requiredParts, publicSite ? await sitePromise : undefined];

  const latencyMs = Math.round(performance.now() - start);
  const flagged = intent.abuse;
  if (flagged.length > 0) {
    return {
      ok: false,
      decisions,
      attempts,
      latencyMs,
      usage,
      errors: [],
      escalate: false,
      rejected: `rejected by the Abuse Guard: ${flagged.map(([k, p]) => `${k} (${p.toFixed(2)})`).join(", ")}`,
    };
  }
  const names = Object.keys(PARTS) as PartName[];
  if (parts.some((p, i) => p === undefined && !OPTIONAL_PARTS.includes(names[i] as PartName))) {
    return { ok: false, decisions, attempts, latencyMs, usage, errors, escalate: true };
  }

  const [meta, entities, pages, criteria, site] = parts as [
    z.infer<typeof PARTS.meta.schema>,
    z.infer<typeof PARTS.entities.schema>,
    z.infer<typeof PARTS.pages.schema>,
    z.infer<typeof PARTS.criteria.schema>,
    z.infer<typeof PARTS.site.schema> | undefined,
  ];
  const outOfScope = decisions.recipe.choice === "out_of_scope";
  const closest = Object.entries(decisions.recipe.probabilities)
    .filter(([k]) => k !== "out_of_scope")
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  const capabilities = [...ALWAYS_ON, ...intent.capabilities];

  const parsed = buildSpecSchema.safeParse({
    recipe: decisions.recipe.choice,
    out_of_scope_reason: outOfScope ? "No ready-made template matches this need exactly." : null,
    closest_recipe: outOfScope ? (closest ?? null) : null,
    ...meta,
    ...entities,
    ...pages,
    capabilities,
    ...criteria,
    site: site ?? null,
    palette: extractPalette(prompt),
  });
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`));
    return { ok: false, decisions, attempts, latencyMs, usage, errors, escalate: true };
  }
  // Deterministic guard (ADR-0037 §D3): rate limits, input limits, logging… are capabilities, never CRUD entities.
  const separated = separateNonFunctional(parsed.data);
  return {
    ok: true,
    spec: separated.spec,
    nonFunctional: separated.requirements,
    decisions,
    attempts,
    latencyMs,
    usage,
    errors,
    escalate: false,
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

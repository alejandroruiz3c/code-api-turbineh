import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { BackupPolicyError, checkBackupCode } from "./policy.js";

/** Triggers from PLAN §2.4. The policy that fires them lives in the calling module, in code. */
export const TRIGGERS = {
  T1: "capability without any approved component",
  T2: "decider says no candidate meets acceptance",
  T3: "high-complexity glue",
  T4: "correction loop exhausted and component swap failed",
  T5: "compiler failed to produce a valid BuildSpec after retries",
  T6: "phase asked for help after an unclassified failure",
} as const;
export type Trigger = keyof typeof TRIGGERS;

export const GENERATED_BACKUP_HEADER = "// turbineh:generated-backup";

export interface CoderSlot {
  /** `<provider>:<model>` — open-weights models only (ADR-0003). */
  ref: string;
  baseURL: string;
  apiKey: string;
}

export interface GapRequest {
  buildId: string;
  trigger: Trigger;
  capability: string;
  /** Minimal context only: neighbouring contracts, the BuildSpec slice and the error. Never the whole app. */
  context: { contracts?: string[]; buildSpec?: unknown; error?: string };
  instructions: string;
  /** Hard cap on output tokens for the gap (R10: keep backup usage small). */
  maxOutputTokens?: number;
}

export interface GapResult {
  code: string;
  slot: "primary" | "secondary";
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  failedOver: boolean;
  primaryError?: string;
}

const SYSTEM = `You fill one small gap in a TypeScript/Next.js app assembled from verified components.
Write ONLY the code for the requested gap, as a single TypeScript module. No prose, no markdown fences.
Respect the given component contracts. Validate inputs with zod. Never hardcode secrets.`;

function modelOf(ref: string): string {
  return ref.slice(ref.indexOf(":") + 1);
}

function stripFences(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export class BackupCoder {
  constructor(
    private readonly primary: CoderSlot,
    private readonly secondary: CoderSlot,
    private readonly opts: { timeoutMs?: number; reasoningEffort?: string } = {},
  ) {}

  /**
   * Generates the gap with the primary model; on any error the secondary takes over automatically. Output that
   * breaks the deterministic policy (ADR-0055: non-cryptographic hashes, demo/placeholder code) counts as an error:
   * the secondary gets one try, then the gap fails and the caller reports it as not covered.
   */
  async fill(req: GapRequest): Promise<GapResult> {
    const baseline = [...(req.context.contracts ?? [])].join("\n");
    const checked = async (slot: CoderSlot, name: "primary" | "secondary") => {
      const res = await this.#run(slot, name, req);
      const violations = checkBackupCode(res.code, baseline);
      if (violations.length > 0) throw new BackupPolicyError(violations);
      return res;
    };
    try {
      return await checked(this.primary, "primary");
    } catch (err) {
      const res = await checked(this.secondary, "secondary");
      return { ...res, failedOver: true, primaryError: (err as Error).message };
    }
  }

  /** Minimal liveness check of one slot (used by the WP4 smoke test). */
  async ping(
    which: "primary" | "secondary",
  ): Promise<{ model: string; latencyMs: number; reply: string }> {
    const slot = which === "primary" ? this.primary : this.secondary;
    const start = performance.now();
    const res = await this.#client(slot).chat.completions.create({
      model: modelOf(slot.ref),
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      ...(this.opts.reasoningEffort
        ? { reasoning_effort: this.opts.reasoningEffort as OpenAI.ReasoningEffort }
        : {}),
    });
    return {
      model: res.model,
      latencyMs: Math.round(performance.now() - start),
      reply: res.choices[0]?.message.content?.trim() ?? "",
    };
  }

  #client(slot: CoderSlot): OpenAI {
    return new OpenAI({
      baseURL: slot.baseURL,
      apiKey: slot.apiKey,
      timeout: this.opts.timeoutMs ?? 120_000,
      maxRetries: 1,
    });
  }

  async #run(slot: CoderSlot, name: "primary" | "secondary", req: GapRequest): Promise<GapResult> {
    const start = performance.now();
    const res = await this.#client(slot).chat.completions.create({
      model: modelOf(slot.ref),
      temperature: 0,
      max_tokens: req.maxOutputTokens ?? 2048,
      ...(this.opts.reasoningEffort
        ? { reasoning_effort: this.opts.reasoningEffort as OpenAI.ReasoningEffort }
        : {}),
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            capability: req.capability,
            instructions: req.instructions,
            context: req.context,
          }),
        },
      ],
    });
    const body = stripFences(res.choices[0]?.message.content ?? "");
    if (!body) throw new Error(`${name} returned empty output`);
    return {
      code: `${GENERATED_BACKUP_HEADER} trigger=${req.trigger} model=${slot.ref}\n${body}\n`,
      slot: name,
      model: res.model,
      usage: {
        input_tokens: res.usage?.prompt_tokens ?? 0,
        output_tokens: res.usage?.completion_tokens ?? 0,
      },
      latencyMs: Math.round(performance.now() - start),
      failedOver: false,
    };
  }
}

/** Catalog flywheel: every covered gap becomes a candidate-component record in catalog/gaps/. */
export function recordGap(gapsDir: string, req: GapRequest, res: GapResult): string {
  mkdirSync(gapsDir, { recursive: true });
  const file = join(
    gapsDir,
    `${new Date().toISOString().slice(0, 10)}-${req.capability}-${req.buildId}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        build_id: req.buildId,
        capability: req.capability,
        trigger: req.trigger,
        trigger_reason: TRIGGERS[req.trigger],
        model: res.model,
        slot: res.slot,
        failed_over: res.failedOver,
        usage: res.usage,
        code: res.code,
      },
      null,
      2,
    ) + "\n",
  );
  return file;
}

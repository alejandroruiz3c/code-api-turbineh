import { z } from "zod";
import type { ToolSpec } from "./guard";
import type { Route } from "./models";
import type { Plan } from "./plan";

/**
 * Orchestrator decisions (component ai.orchestrator.turbineh, ADR-0028/ADR-0029): one plain request to the TurbineH
 * AI gateway, which holds every provider key. One request carries every question; thresholds are applied in code,
 * not by a model. The app talks only to TurbineH.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  TURBINEH_AI_URL: z.preprocess(empty, z.url().default("https://software.turbineh.com/v1/ai")),
  TURBINEH_AI_TOKEN: z.preprocess(empty, z.string().min(1).optional()),
});

type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: undefined };

const choice = (instructions: string, criteria: Record<string, string>): Question => ({
  type: "choice",
  instructions,
  criteria,
});
const noul = (instructions: string): Question => ({ type: "noul", instructions });

const Answer = z.union([
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number(),
    probabilities: z.record(z.string(), z.number()),
  }),
  z.object({ type: z.literal("noul"), noul: z.number() }),
]);
const Decision = z.object({
  answers: z.record(z.string(), Answer),
  model: z.string(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export interface RouteDecision {
  route: string;
  /** Probability that the request is harmful or outside the app's purpose. */
  unsafe: number;
  tool: string | null;
  toolConfidence: number;
  probabilities: Record<string, Record<string, number> | number>;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Thrown when no decider is configured; the orchestrator then uses its default route (recorded in the audit). */
export class DeciderUnavailable extends Error {}

async function decide(
  cfg: { url: string; token: string },
  state: unknown,
  questions: Record<string, Question>,
): Promise<z.infer<typeof Decision>> {
  const res = await fetch(`${cfg.url}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ state, questions }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TurbineH AI gateway answered ${res.status}`);
  return Decision.parse(await res.json());
}

export async function decideRoute(
  plan: Plan,
  routes: readonly Route[],
  tools: readonly ToolSpec[],
  requestPreview: string,
): Promise<RouteDecision> {
  const cfg = Env.parse(process.env);
  if (!cfg.TURBINEH_AI_TOKEN) throw new DeciderUnavailable("TURBINEH_AI_TOKEN is not set");
  const state = {
    request: requestPreview.slice(0, 2000),
    intent: plan.intent,
    subtasks: plan.subtasks,
    needs_reasoning: plan.needs_reasoning,
    needs_long_context: plan.needs_long_context,
  };
  const questions: Record<string, Question> = {
    route: choice(
      "Which model route fits this request best (cheapest that can do it well)?",
      Object.fromEntries(routes.map((r) => [r.name, r.description])),
    ),
    unsafe: noul(
      "The request asks for something harmful, deceptive, illegal or clearly outside the purpose of a business assistant.",
    ),
  };
  if (tools.length > 0)
    questions.tool = choice("Which tool, if any, must be used to fulfil the request?", {
      none: "No tool: answer directly.",
      ...Object.fromEntries(tools.map((t) => [t.name, t.description])),
    });
  const res = await decide(
    { url: cfg.TURBINEH_AI_URL.replace(/\/$/, ""), token: cfg.TURBINEH_AI_TOKEN },
    state,
    questions,
  );
  const { route: r, unsafe: u, tool: t } = res.answers;
  const route = r?.type === "choice" ? r.choice : (routes[0]?.name ?? "");
  const unsafe = u?.type === "noul" ? u.noul : 0;
  const tool = t?.type === "choice" && t.choice !== "none" ? t.choice : null;
  return {
    route,
    unsafe,
    tool,
    toolConfidence: t?.type === "choice" ? t.confidence : 0,
    probabilities: {
      ...(r?.type === "choice" ? { route: r.probabilities } : {}),
      unsafe,
      ...(t?.type === "choice" ? { tool: t.probabilities } : {}),
    },
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

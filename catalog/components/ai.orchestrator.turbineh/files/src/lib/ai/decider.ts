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
  /** One attempt of a decision (ms); a timed-out or failed attempt is retried once (ADR-0043). */
  AI_DECIDER_ATTEMPT_TIMEOUT_MS: z.preprocess(
    empty,
    z.coerce.number().int().min(500).max(60_000).default(5000),
  ),
});

/** Attempts per decision: the first and one retry. */
export const DECIDER_ATTEMPTS = 2;

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
  cfg: { url: string; token: string; attemptMs: number },
  state: unknown,
  questions: Record<string, Question>,
): Promise<z.infer<typeof Decision>> {
  for (let attempt = 0; ; attempt++) {
    // 0 = network failure, timeout or an unreadable body.
    let status = 0;
    try {
      const res = await fetch(`${cfg.url}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(cfg.attemptMs),
      });
      status = res.status;
      if (res.ok) return Decision.parse(await res.json());
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt + 1 >= DECIDER_ATTEMPTS)
      throw new Error(`TurbineH AI gateway answered ${status || "nothing"}`);
    await new Promise((r) => setTimeout(r, status === 429 ? 1000 : 200));
  }
}

/** Gateway settings; throws DeciderUnavailable when the app has no token (the caller then uses its defaults). */
function gateway(): { url: string; token: string; attemptMs: number } {
  const cfg = Env.parse(process.env);
  if (!cfg.TURBINEH_AI_TOKEN) throw new DeciderUnavailable("TURBINEH_AI_TOKEN is not set");
  return {
    url: cfg.TURBINEH_AI_URL.replace(/\/$/, ""),
    token: cfg.TURBINEH_AI_TOKEN,
    attemptMs: cfg.AI_DECIDER_ATTEMPT_TIMEOUT_MS,
  };
}

/** The route and safety questions, shared by orchestrate() and runAgent(). */
function routeQuestions(routes: readonly Route[]): Record<string, Question> {
  return {
    route: choice(
      "Which model route fits this request best (cheapest that can do it well)?",
      Object.fromEntries(routes.map((r) => [r.name, r.description])),
    ),
    unsafe: noul(
      "The request asks for something harmful, deceptive, illegal or clearly outside the purpose of a business assistant.",
    ),
  };
}

export async function decideRoute(
  plan: Plan,
  routes: readonly Route[],
  tools: readonly ToolSpec[],
  requestPreview: string,
): Promise<RouteDecision> {
  const cfg = gateway();
  const state = {
    request: requestPreview.slice(0, 2000),
    intent: plan.intent,
    subtasks: plan.subtasks,
    needs_reasoning: plan.needs_reasoning,
    needs_long_context: plan.needs_long_context,
  };
  const questions = routeQuestions(routes);
  if (tools.length > 0)
    questions.tool = choice("Which tool, if any, must be used to fulfil the request?", {
      none: "No tool: answer directly.",
      ...Object.fromEntries(tools.map((t) => [t.name, t.description])),
    });
  const res = await decide(cfg, state, questions);
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

/** The `next` option that means "answer the person now, without a tool" (runAgent). */
export const REPLY_ACTION = "reply";

export interface AgentTurnInput {
  /** The person's latest message. */
  request: string;
  /** Recent turns, plain text, oldest first. */
  conversation: string;
}

export interface AgentTurnDecision {
  route: string;
  unsafe: number;
  /** First action of the turn: a tool name or REPLY_ACTION. */
  next: string;
  /** Calibrated confidence of `next` (0–1); runAgent applies its threshold in code. */
  confidence: number;
  probabilities: Record<string, unknown>;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * runAgent's decision for one turn (ADR-0039), in the same single request as before: the route, the safety check and
 * the first action — one of the tools or a plain reply — as one Choice over the tools the app offers. The open model
 * then writes only the chosen tool's arguments, or only the reply. Later steps of the turn (after a tool result) are
 * left to the model: a decider request per step was measured slower and costlier for the same accuracy.
 */
export async function decideAgentTurn(
  input: AgentTurnInput,
  tools: readonly ToolSpec[],
  routes: readonly Route[],
): Promise<AgentTurnDecision> {
  const cfg = gateway();
  const state = {
    latest_message: input.request.slice(0, 2000),
    conversation: input.conversation.slice(-3000) || "none",
  };
  const questions: Record<string, Question> = {
    ...routeQuestions(routes),
    next: choice(
      "Which action should the assistant take first to serve the person correctly? Use a tool when it provides a fact the answer needs (availability, prices, records, policies) or does what the person asked; reply when the person must first give or confirm details, or when no tool is needed.",
      {
        [REPLY_ACTION]: "Answer the person now, without using a tool.",
        ...Object.fromEntries(
          tools.map((t) => [
            t.name,
            t.irreversible
              ? `${t.description} (the person confirms before it runs)`
              : t.description,
          ]),
        ),
      },
    ),
  };
  const res = await decide(cfg, state, questions);
  const { route: r, unsafe: u, next: n } = res.answers;
  const offered = new Set([REPLY_ACTION, ...tools.map((t) => t.name)]);
  const valid = n?.type === "choice" && offered.has(n.choice);
  return {
    route: r?.type === "choice" ? r.choice : (routes[0]?.name ?? ""),
    unsafe: u?.type === "noul" ? u.noul : 0,
    next: valid ? n.choice : REPLY_ACTION,
    confidence: valid ? n.confidence : 0,
    probabilities: {
      ...(r?.type === "choice" ? { route: r.probabilities } : {}),
      ...(u?.type === "noul" ? { unsafe: u.noul } : {}),
      ...(n?.type === "choice" ? { next: n.probabilities } : {}),
    },
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

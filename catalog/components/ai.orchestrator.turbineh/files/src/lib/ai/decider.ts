import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { ToolSpec } from "./guard";
import type { Route } from "./models";
import type { Plan } from "./plan";

/**
 * Orchestrator decisions with JEV by TypeSafe (component ai.orchestrator.turbineh, ADR-0028), through the official
 * SDK. TYPESAFE_BASE_URL points to an open SystemOne-compatible decider instead (same request shape). One request
 * carries every question; thresholds are applied in code, not by a model.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  TYPESAFE_API_KEY: z.preprocess(empty, z.string().min(1).optional()),
  TYPESAFE_BASE_URL: z.preprocess(empty, z.url().optional()),
  TYPESAFE_MODEL: z.preprocess(empty, z.string().min(1).default("jev-1.13.0")),
});

let client: TypeSafeClient | undefined;
function decider(): { client: TypeSafeClient; model: string } | null {
  const cfg = Env.parse(process.env);
  if (!cfg.TYPESAFE_API_KEY) return null;
  client ??= new TypeSafeClient({
    apiKey: cfg.TYPESAFE_API_KEY,
    defaultModel: cfg.TYPESAFE_MODEL,
    timeout: 15_000,
    logLevel: "off",
    ...(cfg.TYPESAFE_BASE_URL ? { baseURL: cfg.TYPESAFE_BASE_URL } : {}),
  });
  return { client, model: cfg.TYPESAFE_MODEL };
}

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

export async function decideRoute(
  plan: Plan,
  routes: readonly Route[],
  tools: readonly ToolSpec[],
  requestPreview: string,
): Promise<RouteDecision> {
  const d = decider();
  if (!d) throw new DeciderUnavailable("TYPESAFE_API_KEY is not set");
  const state = {
    request: requestPreview.slice(0, 2000),
    intent: plan.intent,
    subtasks: plan.subtasks,
    needs_reasoning: plan.needs_reasoning,
    needs_long_context: plan.needs_long_context,
  };
  const routeQ = choice(
    "Which model route fits this request best (cheapest that can do it well)?",
    Object.fromEntries(routes.map((r) => [r.name, r.description])),
  );
  const unsafeQ = noul(
    "The request asks for something harmful, deceptive, illegal or clearly outside the purpose of a business assistant.",
  );
  const toolQ =
    tools.length > 0
      ? choice("Which tool, if any, must be used to fulfil the request?", {
          none: "No tool: answer directly.",
          ...Object.fromEntries(tools.map((t) => [t.name, t.description])),
        })
      : null;
  const res = await d.client.systemOne({
    state,
    questions: { route: routeQ, unsafe: unsafeQ, ...(toolQ ? { tool: toolQ } : {}) },
  });
  const answers = res.answers as Record<
    string,
    | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
    | { type: "noul"; noul: number }
    | undefined
  >;
  const route = answers.route?.type === "choice" ? answers.route.choice : (routes[0]?.name ?? "");
  const unsafe = answers.unsafe?.type === "noul" ? answers.unsafe.noul : 0;
  const tool =
    answers.tool?.type === "choice" && answers.tool.choice !== "none" ? answers.tool.choice : null;
  const toolConfidence = answers.tool?.type === "choice" ? answers.tool.confidence : 0;
  return {
    route,
    unsafe,
    tool,
    toolConfidence,
    probabilities: {
      ...(answers.route?.type === "choice" ? { route: answers.route.probabilities } : {}),
      unsafe,
      ...(answers.tool?.type === "choice" ? { tool: answers.tool.probabilities } : {}),
    },
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

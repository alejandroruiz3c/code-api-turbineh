/**
 * Interface of the TurbineH orchestration engine (ADR-0053): the server side of component #001
 * (ai.orchestrator.turbineh). Generated apps ship a thin client; every orchestration decision — route, safety
 * policy, first action of a turn, replies after confirmed actions, retries — runs behind the AI gateway
 * (POST /v1/ai/agent, POST /v1/ai/orchestrate). The apps keep their tools and execute them.
 *
 * The production engine is a private package (private/orchestration). This public package holds only these types and
 * an open minimal fallback (open.ts) so the public repository builds, tests and runs without it.
 */

/** A tool call requested by a model (OpenAI-compatible shape). */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Messages of a tool-calling conversation, as the app stores them. */
export type AgentMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool the app offers: name, description, JSON Schema of its arguments; irreversible = confirmed by a person. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  irreversible: boolean;
}

/** A document retrieved by the app for the request (data, never instructions). */
export interface ContextDoc {
  title: string;
  text: string;
}

/**
 * One step of an agent turn.
 *  - "start": the person's message is the last of `messages`;
 *  - "continue": the app ran the tool calls of the previous step and appended their results;
 *  - "confirmed": the app ran an irreversible action the person explicitly confirmed (`confirmed`), and appended
 *    the call and its result.
 */
export interface AgentStepRequest {
  phase: "start" | "continue" | "confirmed";
  /** App/domain instructions, written by the app. */
  instructions: string;
  tools: ToolDef[];
  messages: AgentMessage[];
  context?: ContextDoc[];
  /** Clock of the app (ISO 8601). */
  now: string;
  /** Route chosen in an earlier step of the same turn. */
  route?: string;
  confirmed?: { summary: string; result: unknown; failed: boolean };
  /** Remaining budget of the turn, ms. */
  timeoutMs: number;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** "orchestrated" = decided by the orchestration; "skipped" = not needed; "none"/"unavailable" = default route. */
export type DecisionSource = "orchestrated" | "skipped" | "none" | "unavailable";

/** Either a reply (no tool calls) or tool calls for the app to run. */
export interface AgentStepResult {
  reply: string | null;
  toolCalls: ToolCall[];
  route: string;
  model: string;
  flags: string[];
  usage: Usage;
  decision: DecisionSource;
}

export interface OrchestrateRequest {
  /** What the app wants done (written by the app). */
  task: string;
  /** The person's text or the record to process (already checked by the app's safety guards). */
  input: string;
  instructions?: string;
  context?: ContextDoc[];
  history?: { role: "user" | "assistant"; content: string }[];
  /** JSON Schema the answer must match (structured output). */
  schema?: Record<string, unknown>;
  tools?: { name: string; description: string; irreversible: boolean }[];
  timeoutMs: number;
}

export interface OrchestrateResult {
  /** The answer (JSON text when a schema was given). */
  text: string;
  route: string;
  model: string;
  /** Tool the orchestration chose for the app, if any. */
  tool: string | null;
  flags: string[];
  usage: Usage;
  decision: DecisionSource;
}

export interface Route {
  name: string;
  model: string;
}

/** One model call (OpenAI-compatible chat body; the gateway validates it against its allow-list). */
export interface ChatCall {
  model: string;
  messages: ({ role: "system"; content: string } | AgentMessage)[];
  tools?: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  tool_choice?: "auto" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
}

export interface ChatAnswer {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

/** Decision request/answer in the decider's wire shape. */
export interface DecisionAnswer {
  answers: Record<string, unknown>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * What the gateway gives the engine. Every call is billed to the app and counted on its account's trial spend by
 * the gateway. Failed attempts throw an EngineError with code "upstream" (status 0 = no answer in time).
 */
export interface EngineIO {
  /** Routes the gateway allows, cheapest first. */
  routes: Route[];
  /** Small model that prepares requests. */
  structurerModel: string;
  chat: (call: ChatCall, timeoutMs: number) => Promise<ChatAnswer>;
  /** Undefined when no decider is configured. */
  decide?: (
    state: Record<string, unknown>,
    questions: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<DecisionAnswer>;
  /** True when `value` matches the JSON Schema (true when the schema cannot be checked). */
  validate: (schema: Record<string, unknown>, value: unknown) => boolean;
}

/** Failures the gateway maps to responses: "unsafe" → 422 refusal; "upstream" → 502/504; "invalid" → 400. */
export interface EngineError extends Error {
  code: "unsafe" | "upstream" | "invalid";
  status?: number;
}

export const engineError = (
  code: EngineError["code"],
  message: string,
  status?: number,
): EngineError =>
  Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) });

export const isEngineError = (err: unknown): err is EngineError =>
  err instanceof Error &&
  ["unsafe", "upstream", "invalid"].includes(String((err as { code?: unknown }).code));

export interface OrchestrationEngine {
  /** "private" = the production engine; "open" = the public minimal fallback. */
  readonly edition: "private" | "open";
  agentStep: (req: AgentStepRequest, io: EngineIO) => Promise<AgentStepResult>;
  orchestrate: (req: OrchestrateRequest, io: EngineIO) => Promise<OrchestrateResult>;
}

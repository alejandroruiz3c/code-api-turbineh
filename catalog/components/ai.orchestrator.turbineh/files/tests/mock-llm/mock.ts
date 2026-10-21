import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * Scripted OpenAI-compatible model for tests (component ai.orchestrator.turbineh, ADR-0033). No model, no network:
 *   - POST /v1/chat/completions: when tools are offered, the first script rule whose pattern matches the last user
 *     message (and whose tool is offered) returns a tool call; after a tool result, the script's renderer (or a
 *     generic one) turns it into text. Without tools it behaves like the verification simulator: JSON_SCHEMA
 *     requests get the minimal valid instance, anything else "Mock answer: <start of the message>".
 *   - POST /v1/agent and POST /v1/orchestrate: the TurbineH gateway's orchestration protocol, answered by the same
 *     script (a confirmed action is answered with the tool's `message`, else "Done: <summary>.");
 *   - POST /v1/embeddings (hash-seeded unit vectors), GET /health.
 * Domain components add their own rules in tests/mock-llm/scripts/<domain>.ts (default export: MockScript).
 */
export interface MockMessage {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface MockRule {
  /** Tool to call (the rule is skipped when the request does not offer it). */
  tool: string;
  when: RegExp;
  /** Arguments from the user's text; null = the rule does not apply. */
  args: (text: string, match: RegExpExecArray) => Record<string, unknown> | null;
}

export interface MockScript {
  id: string;
  rules: MockRule[];
  /** Tool result → assistant text, per tool name. */
  render?: Record<
    string,
    (result: Record<string, unknown>, args: Record<string, unknown>) => string
  >;
}

const textOf = (m: MockMessage | undefined) =>
  typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "");

type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
};

/** Minimal valid instance of a JSON Schema (first enum value, minimum lengths, one array item). */
export function sample(schema: JsonSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 8) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const k of ["anyOf", "oneOf", "allOf"]) {
    const list = schema[k];
    if (Array.isArray(list)) return sample(list[0] as JsonSchema, depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const req = new Set(schema.required ?? Object.keys(schema.properties ?? {}));
      for (const [k, v] of Object.entries(schema.properties ?? {}))
        if (req.has(k)) out[k] = sample(v, depth + 1);
      return out;
    }
    case "array":
      return Array.from({ length: Math.max(Number(schema.minItems ?? 1), 1) }, () =>
        sample(schema.items, depth + 1),
      );
    case "string": {
      const s = "sample text";
      return s.padEnd(Number(schema.minLength ?? 0), "x").slice(0, Number(schema.maxLength ?? 11));
    }
    case "integer":
    case "number":
      return schema.minimum ?? schema.exclusiveMinimum ?? 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

/** Generic tool-result renderer: errors, confirmation summaries, `message` fields, otherwise compact JSON. */
export function renderResult(result: Record<string, unknown>): string {
  if (typeof result.error === "string") return `Sorry: ${result.error}`;
  if (result.status === "awaiting_confirmation") return String(result.summary ?? "");
  if (typeof result.message === "string") return result.message;
  return JSON.stringify(result).slice(0, 1500);
}

let callCounter = 0;
const reply = (message: Record<string, unknown>, inTok: number, outTok: number, model: string) => ({
  id: "chatcmpl-mock",
  object: "chat.completion",
  created: 0,
  model,
  choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
  usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok },
});

export function chatCompletion(
  body: { model?: unknown; messages?: unknown; tools?: unknown },
  scripts: MockScript[],
): unknown {
  const messages = (Array.isArray(body.messages) ? body.messages : []) as MockMessage[];
  const tools = (Array.isArray(body.tools) ? body.tools : []) as {
    function?: { name?: string };
  }[];
  const model = typeof body.model === "string" ? body.model : "mock";
  const inTok = Math.ceil(messages.map(textOf).join(" ").length / 4);
  const text = (content: string) =>
    reply({ role: "assistant", content }, inTok, Math.ceil(content.length / 4), model);
  const offered = new Set(tools.map((t) => t.function?.name ?? ""));
  const last = messages[messages.length - 1];

  if (last?.role === "tool") {
    const call = messages
      .flatMap((m) => m.tool_calls ?? [])
      .find((c) => c.id === last.tool_call_id);
    let result: Record<string, unknown> = {};
    let args: Record<string, unknown> = {};
    try {
      result = JSON.parse(textOf(last)) as Record<string, unknown>;
      args = JSON.parse(call?.function.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      /* rendered generically */
    }
    const name = call?.function.name ?? "";
    const render = scripts.find((s) => s.render?.[name])?.render?.[name];
    return text(
      render && typeof result.error !== "string" ? render(result, args) : renderResult(result),
    );
  }

  if (offered.size > 0 && last?.role === "user") {
    const userText = textOf(last);
    for (const script of scripts) {
      for (const rule of script.rules) {
        if (!offered.has(rule.tool)) continue;
        rule.when.lastIndex = 0;
        const m = rule.when.exec(userText);
        if (!m) continue;
        const args = rule.args(userText, m);
        if (!args) continue;
        const toolCall = {
          id: `call_${++callCounter}`,
          type: "function",
          function: { name: rule.tool, arguments: JSON.stringify(args) },
        };
        return reply(
          { role: "assistant", content: null, tool_calls: [toolCall] },
          inTok,
          10,
          model,
        );
      }
    }
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map(textOf)
    .join("\n");
  const schema = /JSON_SCHEMA:\s*(\{[\s\S]*\})\s*$/m.exec(system);
  if (schema?.[1]) {
    try {
      return text(JSON.stringify(sample(JSON.parse(schema[1]) as JsonSchema)));
    } catch {
      return text("{}");
    }
  }
  const lastUser = textOf([...messages].reverse().find((m) => m.role === "user"));
  return text(`Mock answer: ${lastUser.replace(/\s+/g, " ").slice(0, 60)}`);
}

function vector(text: string, dims: number): number[] {
  const out: number[] = [];
  let seed = createHash("sha256").update(String(text)).digest();
  while (out.length < dims) {
    for (let i = 0; i + 1 < seed.length && out.length < dims; i += 2)
      out.push(seed.readUInt16BE(i) / 65535 - 0.5);
    seed = createHash("sha256").update(seed).digest();
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}

type AgentTool = { name?: string };

/** One step of the gateway's agent protocol, scripted: the same answers as /chat/completions with every tool. */
export function agentStep(
  body: {
    phase?: unknown;
    tools?: unknown;
    messages?: unknown;
    confirmed?: { summary?: unknown; result?: unknown; failed?: unknown };
  },
  scripts: MockScript[],
): unknown {
  const usage = { calls: 1, inputTokens: 10, outputTokens: 5 };
  const base = { route: "mock", model: "mock", flags: [] as string[], decision: "none" };
  if (body.phase === "confirmed" && body.confirmed && body.confirmed.failed !== true) {
    const r = (body.confirmed.result ?? {}) as Record<string, unknown>;
    const reply =
      typeof r.message === "string" && r.message.trim()
        ? r.message
        : `Done: ${String(body.confirmed.summary ?? "").replace(/[.\s]+$/, "")}.`;
    return { ...base, reply, toolCalls: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  }
  const tools = (Array.isArray(body.tools) ? body.tools : []) as AgentTool[];
  const out = chatCompletion(
    {
      model: "mock",
      messages: body.messages,
      tools: tools.map((t) => ({ function: { name: t.name } })),
    },
    scripts,
  ) as { choices: { message: { content?: string | null; tool_calls?: unknown[] } }[] };
  const message = out.choices[0]?.message ?? {};
  return {
    ...base,
    reply: message.tool_calls ? null : (message.content ?? ""),
    toolCalls: message.tool_calls ?? [],
    usage,
  };
}

/**
 * One orchestrated request, scripted like /chat/completions (JSON_SCHEMA → minimal valid instance). Among the tools the
 * request offers, the first script rule whose pattern matches the input chooses the tool (as TurbineH's engine would);
 * a read-only `lookup_<entity>` tool is chosen when the input carries a reference ("A-1001", "#4521").
 */
export function orchestrateRequest(
  body: { input?: unknown; schema?: unknown; tools?: unknown },
  scripts: MockScript[] = [],
): unknown {
  const system = body.schema ? `JSON_SCHEMA: ${JSON.stringify(body.schema)}` : "";
  const input = String(body.input ?? "");
  const out = chatCompletion(
    {
      model: "mock",
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: input },
      ],
    },
    [],
  ) as { choices: { message: { content: string } }[] };
  const offered = (Array.isArray(body.tools) ? body.tools : [])
    .map((t) => (t as { name?: unknown }).name)
    .filter((n): n is string => typeof n === "string");
  let tool: string | null = null;
  for (const rule of scripts.flatMap((s) => s.rules)) {
    if (tool || !offered.includes(rule.tool)) continue;
    rule.when.lastIndex = 0;
    const m = rule.when.exec(input);
    if (m && rule.args(input, m)) tool = rule.tool;
  }
  if (!tool && /#?\b[A-Za-z]{0,6}-?\d[\w-]*\b/.test(input))
    tool = offered.find((n) => n.startsWith("lookup_")) ?? null;
  return {
    text: out.choices[0]?.message.content ?? "",
    route: "mock",
    model: "mock",
    tool,
    flags: [],
    usage: { calls: 1, inputTokens: 10, outputTokens: 5 },
    decision: "none",
  };
}

/** Starts the mock on 127.0.0.1 (port 0 = any free port). */
export function startMockLlm(
  scripts: MockScript[],
  port = 0,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && (req.url === "/health" || req.url?.endsWith("/models")))
      return send(200, { ok: true, object: "list", data: [{ id: "mock", object: "model" }] });
    if (req.method !== "POST") return send(404, { error: { message: "not found" } });
    let raw = "";
    req.on("data", (d: Buffer) => {
      raw += d.toString();
      if (raw.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        return send(400, { error: { message: "invalid JSON" } });
      }
      const path = (req.url ?? "").replace(/\?.*$/, "");
      if (path.endsWith("/chat/completions")) return send(200, chatCompletion(body, scripts));
      if (path.endsWith("/embeddings")) {
        const inputs = (Array.isArray(body.input) ? body.input : [body.input]).map(String);
        const dims = Number(body.dimensions ?? 1024);
        return send(200, {
          object: "list",
          model: typeof body.model === "string" ? body.model : "mock",
          data: inputs.map((t, index) => ({
            object: "embedding",
            index,
            embedding: vector(t, dims),
          })),
          usage: { prompt_tokens: Math.ceil(inputs.join(" ").length / 4) },
        });
      }
      if (path.endsWith("/v1/agent")) return send(200, agentStep(body, scripts));
      if (path.endsWith("/v1/orchestrate")) return send(200, orchestrateRequest(body, scripts));
      return send(404, { error: { message: "not found" } });
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, url: `http://127.0.0.1:${p}` });
    }),
  );
}

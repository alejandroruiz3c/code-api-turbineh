import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * Scripted OpenAI-compatible model for tests (component ai.orchestrator.turbineh, ADR-0032). No model, no network:
 *   - POST /v1/chat/completions: when tools are offered, the first script rule whose pattern matches the last user
 *     message (and whose tool is offered) returns a tool call; after a tool result, the script's renderer (or a
 *     generic one) turns it into text. Without tools it behaves like the verification simulator: JSON_SCHEMA
 *     requests get the minimal valid instance, anything else "Mock answer: <start of the message>".
 *   - POST /v1/embeddings (hash-seeded unit vectors), POST /v1/systemone (first choice, low risk), GET /health.
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
        return reply({ role: "assistant", content: null, tool_calls: [toolCall] }, inTok, 10, model);
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

type Question = { type?: string; criteria?: Record<string, string> };

function systemOne(body: { model?: unknown; questions?: unknown }) {
  const answers: Record<string, unknown> = {};
  const questions = (body.questions ?? {}) as Record<string, Question>;
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "noul") answers[name] = { type: "noul", noul: 0.05 };
    else if (q.type === "choice") {
      const labels = Object.keys(q.criteria ?? {});
      const rest = 0.1 / Math.max(labels.length - 1, 1);
      answers[name] = {
        type: "choice",
        choice: labels[0],
        confidence: 0.9,
        probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.9 : rest])),
      };
    }
  }
  return {
    model: typeof body.model === "string" ? body.model : "mock-decider",
    answers,
    usage: { input_tokens: 10, output_tokens: 1 },
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
      if (path.endsWith("/systemone")) return send(200, systemOne(body));
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

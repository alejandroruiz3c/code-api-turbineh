// Deterministic AI simulator for sandbox verification (no network, no model, no secrets).
// Implements the subset client apps use through the TurbineH orchestrator (component ai.orchestrator.turbineh):
//   POST /v1/agent and /v1/orchestrate (TurbineH gateway orchestration protocol, ADR-0053),
//   POST /v1/chat/completions (OpenAI-compatible), POST /v1/embeddings, POST /v1/systemone,
//   GET /v1/models, GET /health. Same input → same output, so E2E assertions are stable.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);

/** Minimal valid instance of a JSON Schema (first enum value, minimum lengths, one array item). */
function sample(schema, depth = 0) {
  if (!schema || depth > 8) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const k of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[k])) return sample(schema[k][0], depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out = {};
      const req = new Set(schema.required ?? Object.keys(schema.properties ?? {}));
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (req.has(k)) out[k] = sample(v, depth + 1);
      }
      return out;
    }
    case "array":
      return Array.from({ length: Math.max(schema.minItems ?? 1, 1) }, () =>
        sample(schema.items, depth + 1),
      );
    case "string": {
      const s = "sample text";
      return s.padEnd(schema.minLength ?? 0, "x").slice(0, schema.maxLength ?? s.length);
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

const textOf = (m) =>
  typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "");

function chat(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages
    .filter((m) => m.role === "system")
    .map(textOf)
    .join("\n");
  const lastUser = textOf([...messages].reverse().find((m) => m.role === "user"));
  const match = /JSON_SCHEMA:\s*(\{[\s\S]*\})\s*$/m.exec(system);
  let content;
  if (match) {
    try {
      content = JSON.stringify(sample(JSON.parse(match[1])));
    } catch {
      content = "{}";
    }
  } else {
    content = `Mock answer: ${lastUser.replace(/\s+/g, " ").slice(0, 60)}`;
  }
  const inTok = Math.ceil(messages.map(textOf).join(" ").length / 4);
  const outTok = Math.ceil(content.length / 4);
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 0,
    model: body.model ?? "mock",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok },
  };
}

/** Deterministic unit vector per text (hash-seeded), so similarity search returns stable results. */
function vector(text, dims) {
  const out = [];
  let seed = createHash("sha256").update(String(text)).digest();
  while (out.length < dims) {
    for (let i = 0; i + 1 < seed.length && out.length < dims; i += 2) {
      out.push(seed.readUInt16BE(i) / 65535 - 0.5);
    }
    seed = createHash("sha256").update(seed).digest();
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}

function embeddings(body) {
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  const dims = Number(body.dimensions ?? 1024);
  const tokens = Math.ceil(inputs.join(" ").length / 4);
  return {
    object: "list",
    model: body.model ?? "mock",
    data: inputs.map((t, index) => ({ object: "embedding", index, embedding: vector(t, dims) })),
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}

/** TypeSafe SystemOne shape: noul → low probability, choice → first label, score → lowest level. */
function systemOne(body) {
  const answers = {};
  for (const [name, q] of Object.entries(body.questions ?? {})) {
    if (q.type === "noul") answers[name] = { type: "noul", noul: 0.05 };
    else if (q.type === "choice") {
      const labels = Object.keys(q.criteria ?? {});
      const rest = 0.1 / Math.max(labels.length - 1, 1);
      const probabilities = Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.9 : rest]));
      answers[name] = { type: "choice", choice: labels[0], confidence: 0.9, probabilities };
    } else if (q.type === "score") {
      const criteria = Array.isArray(q.criteria) ? q.criteria : [];
      const rest = 0.1 / Math.max(criteria.length - 1, 1);
      const probabilities = Object.fromEntries(
        criteria.map((_, i) => [String(i), i === 0 ? 0.9 : rest]),
      );
      const legend = Object.fromEntries(criteria.map((d, i) => [String(i), d]));
      answers[name] = { type: "score", score: 0, confidence: 0.9, legend, probabilities };
    }
  }
  return {
    model: body.model ?? "mock-decider",
    answers,
    usage: { input_tokens: 10, output_tokens: 1 },
  };
}

/**
 * TurbineH gateway orchestration protocol (ADR-0053): one agent step answers like /v1/chat/completions (no tool
 * calls); a confirmed action is answered with the tool's `message`, else "Done: <summary>.".
 */
function agentStep(body) {
  const base = { route: "mock", model: "mock", flags: [], decision: "none", toolCalls: [] };
  if (body.phase === "confirmed" && body.confirmed && body.confirmed.failed !== true) {
    const r = body.confirmed.result ?? {};
    const reply =
      typeof r.message === "string" && r.message.trim()
        ? r.message
        : `Done: ${String(body.confirmed.summary ?? "").replace(/[.\s]+$/, "")}.`;
    return { ...base, reply, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  }
  const out = chat({ messages: Array.isArray(body.messages) ? body.messages : [] });
  return {
    ...base,
    reply: out.choices[0].message.content,
    usage: {
      calls: 1,
      inputTokens: out.usage.prompt_tokens,
      outputTokens: out.usage.completion_tokens,
    },
  };
}

function orchestrate(body) {
  const messages = [
    ...(body.schema
      ? [{ role: "system", content: `JSON_SCHEMA: ${JSON.stringify(body.schema)}` }]
      : []),
    { role: "user", content: String(body.input ?? "") },
  ];
  const out = chat({ messages });
  return {
    text: out.choices[0].message.content,
    route: "mock",
    model: "mock",
    tool: null,
    flags: [],
    usage: {
      calls: 1,
      inputTokens: out.usage.prompt_tokens,
      outputTokens: out.usage.completion_tokens,
    },
    decision: "none",
  };
}

createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
  if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
    return send(200, { object: "list", data: [{ id: "mock", object: "model" }] });
  }
  if (req.method !== "POST") return send(404, { error: { message: "not found" } });
  let raw = "";
  req.on("data", (d) => {
    raw += d;
    if (raw.length > 5_000_000) req.destroy();
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return send(400, { error: { message: "invalid JSON" } });
    }
    if (req.url === "/v1/chat/completions") return send(200, chat(body));
    if (req.url === "/v1/embeddings") return send(200, embeddings(body));
    if (req.url === "/v1/systemone") return send(200, systemOne(body));
    if (req.url === "/v1/agent") return send(200, agentStep(body));
    if (req.url === "/v1/orchestrate") return send(200, orchestrate(body));
    return send(404, { error: { message: "not found" } });
  });
}).listen(PORT, "0.0.0.0", () => console.log(`ai-mock listening on ${PORT}`));

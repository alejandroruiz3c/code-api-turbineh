import type { AiApp } from "@turbineh/db";
import type { OrchestrateRequest, OrchestrationEngine } from "@turbineh/orchestration";
import { engine as installedEngine } from "@turbineh/orchestration/engine";
import { describe, expect, it } from "vitest";
import { type GatewayDeps, gatewayConfig, TRIAL_REMAINING_HEADER } from "./ai-gateway";
import { handleMcp, TOOLS } from "./ai-mcp";
import { chatToOrchestrate, handleChatCompletions, handleOrchestration } from "./ai-orchestration";

/**
 * Intelligence Orchestration as a product (ADR-0059): a trial token without a build uses the OpenAI-compatible chat
 * (orchestrated routing), /orchestrate, /agent and the remote MCP server, with the remaining trial balance and the
 * $2 cap.
 */

/** A trial account's token: no build. */
const TRIAL: AiApp = {
  id: "app-trial",
  ownerId: "trial:0123456789abcdef01234567",
  buildId: null,
  dailyTokenQuota: 1_000_000,
  requestsPerMinute: 100,
};
const OWNER = TRIAL.ownerId;

function gateway(spent: Record<string, number> = {}) {
  const upstream: { url: string; body: Record<string, unknown> }[] = [];
  const d: GatewayDeps = {
    verifyToken: async (t) => (t === "tbh_ai_trial" ? TRIAL : null),
    admit: async () => ({ ok: true }),
    record: async () => undefined,
    reserveHedge: async () => false,
    trialSpent: async (owner) => spent[owner] ?? 0,
    addSpend: async (owner, usd) => {
      spent[owner] = (spent[owner] ?? 0) + usd;
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      upstream.push({ url: String(url), body: JSON.parse(String(init?.body)) as never });
      if (String(url).endsWith("/systemone"))
        return Response.json({
          answers: {
            route: { type: "choice", choice: "fast", confidence: 0.9, probabilities: {} },
            unsafe: { type: "noul", noul: 0.01 },
            next: { type: "choice", choice: "reply", confidence: 0.9, probabilities: {} },
          },
          model: "d",
          usage: { input_tokens: 100, output_tokens: 1 },
        });
      return Response.json({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 100_000, completion_tokens: 1000 },
      });
    }) as typeof fetch,
    config: gatewayConfig({
      AI_GATEWAY_UPSTREAM_URL: "https://models.example/v1",
      AI_GATEWAY_UPSTREAM_KEY: "k",
      AI_GATEWAY_TYPESAFE_URL: "https://decider.example",
      AI_GATEWAY_TYPESAFE_KEY: "k2",
    }),
  };
  return { d, upstream, spent };
}

/** A scripted engine: one model call through the gateway's I/O, then the answer. */
function scripted(seen: OrchestrateRequest[] = []): OrchestrationEngine {
  return {
    edition: "open",
    agentStep: async () => {
      throw new Error("unused");
    },
    orchestrate: async (req, io) => {
      seen.push(req);
      const route = io.routes[0];
      if (!route) throw new Error("no route");
      const a = await io.chat(
        { model: route.model, messages: [{ role: "user", content: req.input }] },
        req.timeoutMs,
      );
      return {
        text: a.text,
        route: route.name,
        model: route.model,
        tool: null,
        flags: [],
        usage: { calls: 1, inputTokens: a.inputTokens, outputTokens: a.outputTokens },
        decision: "none",
      };
    },
  };
}

const post = (body: unknown, token = "tbh_ai_trial") =>
  new Request("https://gw.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const MESSAGE =
  "You've reached the trial limit of the TurbineH orchestration ($2). Contact alex.ruiz@turbineh.com to continue.";

describe("OpenAI-compatible chat with orchestrated routing (ADR-0059)", () => {
  const convo = {
    model: "turbineh-orchestration",
    messages: [
      { role: "system", content: "Answer in French." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Bonjour" },
      { role: "user", content: [{ type: "text", text: "Summarize this." }] },
    ],
  };

  it("maps a conversation to one orchestrated request", () => {
    expect(chatToOrchestrate({ messages: convo.messages as never })).toEqual({
      task: "Reply to the user's last message.",
      input: "Summarize this.",
      instructions: "Answer in French.",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Bonjour" },
      ],
      timeoutMs: 60_000,
    });
    expect(chatToOrchestrate({ messages: [{ role: "assistant", content: "x" }] })).toBeNull();
  });

  it("answers in the chat.completion shape with usage and the remaining trial balance", async () => {
    const g = gateway({ [OWNER]: 0.5 });
    const seen: OrchestrateRequest[] = [];
    const res = await handleChatCompletions(post(convo), g.d, scripted(seen));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      model: string;
      choices: { message: { role: string; content: string }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("turbineh-orchestration");
    expect(body.choices[0]?.message).toEqual({ role: "assistant", content: '{"ok":true}' });
    expect(body.usage).toEqual({
      prompt_tokens: 100_000,
      completion_tokens: 1000,
      total_tokens: 101_000,
    });
    expect(seen[0]?.instructions).toBe("Answer in French.");
    expect(g.spent[OWNER]).toBeGreaterThan(0.5);
    const remaining = Number(res.headers.get(TRIAL_REMAINING_HEADER));
    expect(remaining).toBeCloseTo(2 - (g.spent[OWNER] ?? 0), 4);
  });

  it("'auto' and no model are orchestrated too; an allowed model id is forwarded as before", async () => {
    const g = gateway();
    for (const model of ["auto", undefined]) {
      const res = await handleChatCompletions(
        post({ ...(model ? { model } : {}), messages: [{ role: "user", content: "x" }] }),
        g.d,
        scripted(),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { model: string }).model).toBe("turbineh-orchestration");
    }
    const direct = await handleChatCompletions(
      post({ model: "gemma-4-26b-a4b-it", messages: [{ role: "user", content: "x" }] }),
      g.d,
      scripted(),
    );
    expect(direct.status).toBe(200);
    expect(direct.headers.get(TRIAL_REMAINING_HEADER)).not.toBeNull();
    expect(
      (
        await handleChatCompletions(
          post({ model: "not-allowed", messages: [{ role: "user", content: "x" }] }),
          g.d,
          scripted(),
        )
      ).status,
    ).toBe(400);
  });

  it("refuses tools, streaming and a last message that is not the user's", async () => {
    const g = gateway();
    const base = { model: "turbineh-orchestration", messages: [{ role: "user", content: "x" }] };
    for (const body of [
      { ...base, tools: [] },
      { ...base, stream: true },
      { ...base, messages: [{ role: "assistant", content: "x" }] },
    ])
      expect((await handleChatCompletions(post(body), g.d, scripted())).status).toBe(400);
    expect(g.upstream).toHaveLength(0);
    expect((await handleChatCompletions(post(base, "nope"), g.d, scripted())).status).toBe(401);
  });

  it("at the cap: 402 trial_limit_reached with the contact, nothing forwarded", async () => {
    const g = gateway({ [OWNER]: 2 });
    const res = await handleChatCompletions(
      post({ model: "turbineh-orchestration", messages: [{ role: "user", content: "x" }] }),
      g.d,
      scripted(),
    );
    expect(res.status).toBe(402);
    expect(res.headers.get(TRIAL_REMAINING_HEADER)).toBe("0");
    expect(((await res.json()) as { detail: string }).detail).toBe(MESSAGE);
    expect(g.upstream).toHaveLength(0);
  });
});

describe("/orchestrate and /agent with a trial token (no build)", () => {
  it("timeoutMs is optional; the answer carries usage and the remaining balance", async () => {
    const g = gateway();
    const res = await handleOrchestration(
      post({ task: "Classify", input: "great product", schema: { type: "object" } }),
      "orchestrate",
      g.d,
      scripted(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; usage: { calls: number } };
    expect(body.text).toBe('{"ok":true}');
    expect(body.usage.calls).toBe(1);
    expect(Number(res.headers.get(TRIAL_REMAINING_HEADER))).toBeLessThan(2);
  });

  it("orchestrated chat runs with the installed engine", async () => {
    const g = gateway();
    const res = await handleChatCompletions(
      post({
        model: "turbineh-orchestration",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "hello" },
        ],
      }),
      g.d,
      installedEngine,
    );
    expect(res.status).toBe(200);
    expect(
      typeof ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]
        ?.message.content,
    ).toBe("string");
  });

  it("an agent step runs with the installed engine", async () => {
    const g = gateway();
    const res = await handleOrchestration(
      post({
        phase: "start",
        instructions: "Help.",
        tools: [],
        messages: [{ role: "user", content: "hello" }],
        now: "2026-10-15T10:00:00.000Z",
      }),
      "agent",
      g.d,
      installedEngine,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get(TRIAL_REMAINING_HEADER)).not.toBeNull();
  });
});

const rpc = (method: string, params?: unknown, id: number | null = 1, token = "tbh_ai_trial") =>
  post(
    { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) },
    token,
  );

describe("remote MCP server (ADR-0059)", () => {
  it("initializes, lists the tools and accepts notifications", async () => {
    const g = gateway();
    const init = await handleMcp(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t" },
      }),
      g.d,
      scripted(),
    );
    const r = (await init.json()) as {
      result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    };
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.serverInfo.name).toBe("turbineh-orchestration");
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(
      (await handleMcp(rpc("notifications/initialized", undefined, null), g.d, scripted())).status,
    ).toBe(202);
    const list = (await (await handleMcp(rpc("tools/list"), g.d, scripted())).json()) as {
      result: { tools: { name: string; description: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(["orchestrate", "chat", "trial_status"]);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(80);
  });

  it("requires the app token; GET is not offered", async () => {
    const g = gateway();
    const res = await handleMcp(rpc("tools/list", undefined, 1, "nope"), g.d, scripted());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect((await handleMcp(new Request("https://gw.test/x"), g.d, scripted())).status).toBe(405);
  });

  it("orchestrate: the answer as text and parsed JSON when a schema is given", async () => {
    const g = gateway();
    const res = await handleMcp(
      rpc("tools/call", {
        name: "orchestrate",
        arguments: { task: "Extract", input: "x", schema: { type: "object" } },
      }),
      g.d,
      scripted(),
    );
    const r = (await res.json()) as {
      result: {
        content: { text: string }[];
        structuredContent: { answer: unknown; trialRemainingUsd: number };
        isError: boolean;
      };
    };
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0]?.text).toBe('{"ok":true}');
    expect(r.result.structuredContent.answer).toEqual({ ok: true });
    expect(r.result.structuredContent.trialRemainingUsd).toBeLessThan(2);
  });

  it("chat and trial_status", async () => {
    const g = gateway({ [OWNER]: 0.25 });
    const chat = (await (
      await handleMcp(
        rpc("tools/call", {
          name: "chat",
          arguments: { messages: [{ role: "user", content: "hi" }] },
        }),
        g.d,
        scripted(),
      )
    ).json()) as { result: { structuredContent: { reply: string }; isError: boolean } };
    expect(chat.result.isError).toBe(false);
    expect(chat.result.structuredContent.reply).toBe('{"ok":true}');
    const status = (await (
      await handleMcp(rpc("tools/call", { name: "trial_status", arguments: {} }), g.d, scripted())
    ).json()) as {
      result: { structuredContent: { capUsd: number; remainingUsd: number; reached: boolean } };
    };
    expect(status.result.structuredContent.capUsd).toBe(2);
    expect(status.result.structuredContent.reached).toBe(false);
    expect(status.result.structuredContent.remainingUsd).toBeCloseTo(2 - (g.spent[OWNER] ?? 0), 6);
  });

  it("at the cap: a tool error with the trial-limit message; bad arguments and unknown tools", async () => {
    const g = gateway({ [OWNER]: 2.01 });
    const capped = (await (
      await handleMcp(
        rpc("tools/call", { name: "orchestrate", arguments: { task: "t", input: "x" } }),
        g.d,
        scripted(),
      )
    ).json()) as {
      result: {
        content: { text: string }[];
        structuredContent: { error: { code: string } };
        isError: boolean;
      };
    };
    expect(capped.result.isError).toBe(true);
    expect(capped.result.content[0]?.text).toBe(MESSAGE);
    expect(capped.result.structuredContent.error.code).toBe("trial_limit_reached");
    expect(g.upstream).toHaveLength(0);
    const bad = (await (
      await handleMcp(
        rpc("tools/call", { name: "orchestrate", arguments: { task: "t" } }),
        g.d,
        scripted(),
      )
    ).json()) as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
    const unknown = (await (
      await handleMcp(rpc("tools/call", { name: "nope", arguments: {} }), g.d, scripted())
    ).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
    const method = (await (await handleMcp(rpc("resources/list"), g.d, scripted())).json()) as {
      error: { code: number };
    };
    expect(method.error.code).toBe(-32601);
  });
});

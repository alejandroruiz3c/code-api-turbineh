import type { AiApp } from "@turbineh/db";
import { describe, expect, it, vi } from "vitest";
import { type GatewayDeps, gatewayConfig, handleGateway } from "./ai-gateway";

const APP: AiApp = {
  id: "app-1",
  ownerId: "user:1",
  buildId: "b1",
  dailyTokenQuota: 1000,
  requestsPerMinute: 5,
};
const UPSTREAM_KEY = "sk-upstream-secret-should-never-leak";
const JEV_KEY = "ts-jev-secret-should-never-leak";

function deps(over: Partial<GatewayDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const recorded: unknown[] = [];
  const d: GatewayDeps = {
    verifyToken: async (t) => (t === "tbh_ai_good" ? APP : null),
    admit: async () => ({ ok: true }),
    record: async (u) => void recorded.push(u),
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, input_tokens: 3, output_tokens: 2 },
      });
    }) as unknown as typeof fetch,
    config: gatewayConfig({
      AI_GATEWAY_UPSTREAM_URL: "https://models.example/v1",
      AI_GATEWAY_UPSTREAM_KEY: UPSTREAM_KEY,
      AI_GATEWAY_TYPESAFE_URL: "https://jev.example",
      AI_GATEWAY_TYPESAFE_KEY: JEV_KEY,
      AI_GATEWAY_MAX_BODY_BYTES: "2000",
      AI_GATEWAY_MAX_OUTPUT_TOKENS: "500",
    }),
    ...over,
  };
  return { d, calls, recorded };
}

const req = (body: unknown, token = "tbh_ai_good") =>
  new Request("https://gw.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const chat = (over: Record<string, unknown> = {}) => ({
  model: "gemma-4-26b-a4b-it",
  messages: [{ role: "user", content: "hello" }],
  ...over,
});

describe("TurbineH AI gateway", () => {
  it("rejects missing or unknown tokens before doing anything", async () => {
    const { d, calls } = deps();
    expect((await handleGateway(req(chat(), "tbh_ai_bad"), "chat", d)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("forwards with TurbineH's key, caps output tokens, drops unknown fields and records usage", async () => {
    const { d, calls, recorded } = deps();
    const res = await handleGateway(
      req(chat({ max_tokens: 99_999, user: "x", tools: [] })),
      "chat",
      d,
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe("https://models.example/v1/chat/completions");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${UPSTREAM_KEY}`,
    );
    const sent = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(sent.max_tokens).toBe(500);
    expect(sent).not.toHaveProperty("tools");
    expect(sent).not.toHaveProperty("tool_choice");
    expect(sent).not.toHaveProperty("user");
    expect(recorded).toEqual([
      {
        appId: "app-1",
        endpoint: "chat",
        model: "gemma-4-26b-a4b-it",
        inputTokens: 11,
        outputTokens: 7,
      },
    ]);
  });

  it("forwards the tool-calling turns of runAgent: tools, a forced tool choice, tool calls and results", async () => {
    const { d, calls } = deps();
    const tool = {
      type: "function",
      function: {
        name: "check_availability",
        description: "Free times",
        parameters: { type: "object", properties: { date: { type: "string" } } },
        strict: true,
      },
    };
    const messages = [
      { role: "system", content: "rules" },
      { role: "user", content: "anything tomorrow?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "check_availability", arguments: '{"date":"2026-10-15"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"times":["10:00"]}' },
    ];
    const res = await handleGateway(
      req(
        chat({
          messages,
          tools: [tool],
          tool_choice: { type: "function", function: { name: "check_availability" } },
        }),
      ),
      "chat",
      d,
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(sent.messages).toEqual(messages);
    // Unknown tool fields (here `strict`) are dropped.
    expect(sent.tools).toEqual([
      {
        type: "function",
        function: {
          name: "check_availability",
          description: "Free times",
          parameters: tool.function.parameters,
        },
      },
    ]);
    expect(sent.tool_choice).toEqual({
      type: "function",
      function: { name: "check_availability" },
    });
    // Malformed tool turns are rejected before anything is sent.
    const bad = await handleGateway(
      req(chat({ messages: [{ role: "tool", content: "x" }] })),
      "chat",
      d,
    );
    expect(bad.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("only allows documented models, no streaming and bounded requests", async () => {
    const { d, calls } = deps();
    expect((await handleGateway(req(chat({ model: "gpt-x" })), "chat", d)).status).toBe(400);
    expect((await handleGateway(req(chat({ stream: true })), "chat", d)).status).toBe(400);
    expect((await handleGateway(req("x".repeat(3000)), "chat", d)).status).toBe(413);
    expect((await handleGateway(req("{not json"), "chat", d)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("applies the per-app rate limit and daily quota", async () => {
    const rate = deps({ admit: async () => ({ ok: false, reason: "rate" }) });
    const quota = deps({ admit: async () => ({ ok: false, reason: "quota" }) });
    expect((await handleGateway(req(chat()), "chat", rate.d)).status).toBe(429);
    const q = await handleGateway(req(chat()), "chat", quota.d);
    expect(q.status).toBe(429);
    expect(((await q.json()) as { title: string }).title).toMatch(/quota/i);
    expect(rate.calls).toHaveLength(0);
  });

  it("routes the decider to JEV with the JEV key and records its tokens", async () => {
    const { d, calls, recorded } = deps();
    const res = await handleGateway(
      req({ model: "jev-1.13.0", state: { a: 1 }, questions: { q: { type: "noul" } } }),
      "decider",
      d,
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe("https://jev.example/v1/systemone");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${JEV_KEY}`,
    );
    expect(recorded[0]).toMatchObject({ endpoint: "decider", inputTokens: 3, outputTokens: 2 });
  });

  it("never echoes provider errors or keys", async () => {
    const { d } = deps({
      fetch: (async () =>
        new Response(`upstream says: invalid key ${UPSTREAM_KEY}`, {
          status: 401,
        })) as unknown as typeof fetch,
    });
    const res = await handleGateway(req(chat()), "chat", d);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(UPSTREAM_KEY);
    expect(text).not.toContain("upstream says");
  });

  it("is unavailable, not open, when TurbineH keys are missing", async () => {
    const { d, calls } = deps();
    d.config = gatewayConfig({});
    expect((await handleGateway(req(chat()), "chat", d)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

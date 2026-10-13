import type { AiApp } from "@turbineh/db";
import { describe, expect, it, vi } from "vitest";
import {
  type GatewayDeps,
  gatewayConfig,
  handleGateway,
  hedgeDelay,
  hedgeModel,
} from "./ai-gateway";

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
    reserveHedge: async () => true,
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

  describe("hedged chat requests (ADR-0043)", () => {
    /** Fake upstream: each call answers after its scripted delay (or status), unless it is aborted first. */
    function upstream(script: { ms: number; status?: number; tokens?: number }[]) {
      const seen: { model: string; aborted: () => boolean }[] = [];
      const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
        const step = script[seen.length] ?? { ms: 0 };
        const signal = init?.signal ?? undefined;
        const model = String((JSON.parse(String(init?.body)) as { model: string }).model);
        seen.push({ model, aborted: () => Boolean(signal?.aborted) });
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                step.status
                  ? new Response("upstream failure", { status: step.status })
                  : Response.json({
                      model,
                      choices: [{ message: { content: `answer ${seen.length}` } }],
                      usage: { prompt_tokens: step.tokens ?? 10, completion_tokens: 5 },
                    }),
              ),
            step.ms,
          );
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }) as unknown as typeof fetch;
      return { fetchFn, seen };
    }
    const hedged = (
      script: { ms: number; status?: number; tokens?: number }[],
      env: Record<string, string> = {},
      budget = true,
    ) => {
      const up = upstream(script);
      const reserved: string[] = [];
      const { d, recorded } = deps({
        fetch: up.fetchFn,
        reserveHedge: async (_app, model) => {
          reserved.push(model);
          return budget;
        },
      });
      d.config = gatewayConfig({
        AI_GATEWAY_UPSTREAM_KEY: UPSTREAM_KEY,
        AI_GATEWAY_HEDGE_AFTER_MS: "40",
        AI_GATEWAY_TIMEOUT_MS: "2000",
        ...env,
      });
      return { d, recorded, reserved, seen: up.seen };
    };

    it("slow first answer: the hedge wins, the first request is cancelled, only the answer is billed", async () => {
      const h = hedged([
        { ms: 1500, tokens: 999 },
        { ms: 10, tokens: 10 },
      ]);
      const t0 = Date.now();
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(res.headers.get("x-turbineh-hedge")).toBe("hedge-won");
      expect(
        ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message
          .content,
      ).toBe("answer 2");
      expect(h.seen).toHaveLength(2);
      expect(h.seen[0]?.aborted()).toBe(true);
      expect(h.reserved).toEqual(["gemma-4-26b-a4b-it"]);
      expect(h.recorded).toEqual([
        {
          appId: "app-1",
          endpoint: "chat",
          model: "gemma-4-26b-a4b-it",
          inputTokens: 10,
          outputTokens: 5,
          hedge: "hedge-won",
        },
      ]);
    });

    it("fast first answer: no hedge, no budget used", async () => {
      const h = hedged([{ ms: 5 }]);
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-turbineh-hedge")).toBe("none");
      expect(res.headers.get("server-timing")).toMatch(/^upstream;dur=\d+$/);
      await new Promise((r) => setTimeout(r, 80));
      expect(h.seen).toHaveLength(1);
      expect(h.reserved).toEqual([]);
      expect(h.recorded[0]).not.toHaveProperty("hedge");
    });

    it("both slow: a timeout error at the request deadline, both requests cancelled, nothing billed", async () => {
      const h = hedged([{ ms: 5000 }, { ms: 5000 }], { AI_GATEWAY_TIMEOUT_MS: "200" });
      const t0 = Date.now();
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(504);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(h.seen).toHaveLength(2);
      expect(h.seen.every((s) => s.aborted())).toBe(true);
      expect(h.recorded).toEqual([]);
    });

    it("the first answer wins when it arrives after the hedge was fired", async () => {
      const h = hedged([{ ms: 80 }, { ms: 1500 }]);
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.headers.get("x-turbineh-hedge")).toBe("primary-won");
      expect(h.seen[1]?.aborted()).toBe(true);
      expect(h.recorded[0]).toMatchObject({ hedge: "primary-won" });
    });

    it("at most one hedge, and none when the app's hedge budget is spent", async () => {
      const h = hedged([{ ms: 150 }, { ms: 10 }], {}, false);
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-turbineh-hedge")).toBe("budget");
      expect(h.seen).toHaveLength(1);
      const twice = hedged([{ ms: 200 }, { ms: 200, status: 500 }, { ms: 10 }]);
      expect((await handleGateway(req(chat()), "chat", twice.d)).status).toBe(200);
      expect(twice.seen).toHaveLength(2);
    });

    it("a fast server error of the first request is hedged at once; two failures are an error", async () => {
      const h = hedged([{ ms: 5, status: 503 }, { ms: 5 }], { AI_GATEWAY_HEDGE_AFTER_MS: "5000" });
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-turbineh-hedge")).toBe("hedge-won");
      const bad = hedged([
        { ms: 5, status: 503 },
        { ms: 5, status: 502 },
      ]);
      expect((await handleGateway(req(chat()), "chat", bad.d)).status).toBe(502);
      // Client errors are not hedged.
      const client = hedged([{ ms: 5, status: 400 }]);
      expect((await handleGateway(req(chat()), "chat", client.d)).status).toBe(502);
      expect(client.seen).toHaveLength(1);
    });

    it("hedges to the next allowed model when configured, billed on the model that answered", async () => {
      const h = hedged([{ ms: 1500 }, { ms: 10 }], { AI_GATEWAY_HEDGE_TARGET: "next" });
      const res = await handleGateway(req(chat()), "chat", h.d);
      expect(res.status).toBe(200);
      expect(h.seen.map((s) => s.model)).toEqual(["gemma-4-26b-a4b-it", "deepseek-v4-flash-0731"]);
      expect(h.recorded[0]).toMatchObject({ model: "deepseek-v4-flash-0731", hedge: "hedge-won" });
    });

    it("is off with a zero delay, and never hedges the decider or embeddings", async () => {
      const off = hedged([{ ms: 120 }, { ms: 5 }], { AI_GATEWAY_HEDGE_AFTER_MS: "0" });
      expect((await handleGateway(req(chat()), "chat", off.d)).status).toBe(200);
      expect(off.seen).toHaveLength(1);
      const emb = hedged([{ ms: 120 }, { ms: 5 }]);
      emb.d.config = { ...emb.d.config, AI_GATEWAY_TYPESAFE_KEY: JEV_KEY };
      const r = await handleGateway(
        req({ model: "qwen3-embedding-8b", input: "hello" }),
        "embeddings",
        emb.d,
      );
      expect(r.status).toBe(200);
      expect(r.headers.get("x-turbineh-hedge")).toBeNull();
      expect(emb.seen).toHaveLength(1);
    });

    it("reads per-model delays and the hedge target from the configuration", () => {
      const cfg = gatewayConfig({
        AI_GATEWAY_HEDGE_AFTER_MS_BY_MODEL: "glm-5.2=9000, deepseek-v4-flash-0731=2500",
        AI_GATEWAY_HEDGE_TARGET: "next",
      });
      expect(hedgeDelay(cfg, "gemma-4-26b-a4b-it")).toBe(3800);
      expect(hedgeDelay(cfg, "glm-5.2")).toBe(9000);
      expect(hedgeDelay(cfg, "deepseek-v4-flash-0731")).toBe(2500);
      expect(hedgeModel(cfg, "gemma-4-26b-a4b-it")).toBe("deepseek-v4-flash-0731");
      expect(hedgeModel(cfg, "glm-5.2")).toBe("glm-5.2");
      expect(hedgeModel(gatewayConfig({}), "glm-5.2")).toBe("glm-5.2");
    });
  });
});

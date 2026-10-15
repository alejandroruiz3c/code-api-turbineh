import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AiApp } from "@turbineh/db";
import type { OrchestrationEngine } from "@turbineh/orchestration";
import { engine } from "@turbineh/orchestration/engine";
import { describe, expect, it } from "vitest";
import { callCostUsd } from "./ai-cost";
import { type GatewayDeps, gatewayConfig, handleGateway, trialLimitMessage } from "./ai-gateway";
import { gatewayRoutes, handleOrchestration } from "./ai-orchestration";

const app = (id: string, ownerId: string): AiApp => ({
  id,
  ownerId,
  buildId: null,
  dailyTokenQuota: 1_000_000,
  requestsPerMinute: 100,
});
const APPS: Record<string, AiApp> = {
  tbh_ai_a: app("app-a", "user:1"),
  tbh_ai_b: app("app-b", "user:1"),
  tbh_ai_c: app("app-c", "user:2"),
  tbh_ai_ops: app("app-ops", "ops:smoke"),
};

/** Gateway with an in-memory spend ledger per account (atomic enough for one test process). */
function gateway(spent: Record<string, number> = {}, env: Record<string, string> = {}) {
  const upstream: string[] = [];
  const d: GatewayDeps = {
    verifyToken: async (t) => APPS[t] ?? null,
    admit: async () => ({ ok: true }),
    record: async () => undefined,
    reserveHedge: async () => false,
    trialSpent: async (owner) => spent[owner] ?? 0,
    addSpend: async (owner, usd) => {
      spent[owner] = (spent[owner] ?? 0) + usd;
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      upstream.push(String(url));
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[] };
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
        choices: [{ message: { content: body.tools ? "with tools" : "hi" } }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
      });
    }) as typeof fetch,
    config: gatewayConfig({
      AI_GATEWAY_UPSTREAM_URL: "https://models.example/v1",
      AI_GATEWAY_UPSTREAM_KEY: "k",
      AI_GATEWAY_TYPESAFE_URL: "https://decider.example",
      AI_GATEWAY_TYPESAFE_KEY: "k2",
      AI_TRIAL_EXEMPT_OWNERS: "ops:smoke",
      ...env,
    }),
  };
  return { d, upstream, spent };
}

const post = (body: unknown, token = "tbh_ai_a") =>
  new Request("https://gw.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const chat = { model: "gemma-4-26b-a4b-it", messages: [{ role: "user", content: "hello" }] };
const step = {
  phase: "start",
  instructions: "Help.",
  tools: [],
  messages: [{ role: "user", content: "hello" }],
  now: "2026-10-15T10:00:00.000Z",
  timeoutMs: 20_000,
};
const MESSAGE =
  "You've reached the trial limit of the TurbineH orchestration ($2). Contact alex.ruiz@turbineh.com to continue.";

describe("trial cap per TurbineH account (ADR-0053)", () => {
  it("below the cap: the call goes through and its cost is added to the account", async () => {
    const g = gateway({ "user:1": 1.5 });
    const res = await handleGateway(post(chat), "chat", g.d);
    expect(res.status).toBe(200);
    // 1M input tokens of the small model at its list price, EUR→USD.
    expect(g.spent["user:1"]).toBeCloseTo(1.5 + callCostUsd("chat", "gemma-4-26b-a4b-it", 1e6, 0));
    expect(callCostUsd("chat", "gemma-4-26b-a4b-it", 1e6, 0)).toBeCloseTo(0.27);
  });

  it("at the cap: 402 trial_limit_reached with the contact message, before any upstream call", async () => {
    const g = gateway({ "user:1": 2 });
    const res = await handleGateway(post(chat), "chat", g.d);
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("trial_limit_reached");
    expect(body.detail).toBe(MESSAGE);
    expect(body.title).toBe(MESSAGE);
    expect(g.upstream).toHaveLength(0);
    for (const kind of ["embeddings", "decider"] as const) {
      const r = await handleGateway(
        post(
          kind === "embeddings"
            ? { model: "qwen3-embedding-8b", input: "x" }
            : { state: {}, questions: {} },
        ),
        kind,
        g.d,
      );
      expect(r.status).toBe(402);
    }
    expect((await handleOrchestration(post(step), "agent", g.d, engine)).status).toBe(402);
    expect(g.upstream).toHaveLength(0);
  });

  it("crossing the cap: the call that crosses it is answered, the next one is refused", async () => {
    const g = gateway({ "user:1": 1.9 });
    expect((await handleGateway(post(chat), "chat", g.d)).status).toBe(200);
    expect(g.spent["user:1"]).toBeGreaterThan(2);
    const next = await handleGateway(post(chat), "chat", g.d);
    expect(next.status).toBe(402);
  });

  it("counts every app of the same account together; other accounts and internal owners are not affected", async () => {
    const g = gateway({ "user:1": 1.95, "ops:smoke": 50 });
    expect((await handleGateway(post(chat, "tbh_ai_a"), "chat", g.d)).status).toBe(200);
    // App B belongs to the same account: refused although it never made a call.
    expect((await handleGateway(post(chat, "tbh_ai_b"), "chat", g.d)).status).toBe(402);
    expect((await handleGateway(post(chat, "tbh_ai_c"), "chat", g.d)).status).toBe(200);
    expect((await handleGateway(post(chat, "tbh_ai_ops"), "chat", g.d)).status).toBe(200);
  });

  it("the cap is configurable (AI_TRIAL_CAP_USD; 0 = none) and the message states it", async () => {
    expect(trialLimitMessage(2)).toBe(MESSAGE);
    expect(trialLimitMessage(5.5)).toContain("($5.50)");
    const g = gateway({ "user:1": 3 }, { AI_TRIAL_CAP_USD: "5" });
    expect((await handleGateway(post(chat), "chat", g.d)).status).toBe(200);
    const off = gateway({ "user:1": 99 }, { AI_TRIAL_CAP_USD: "0" });
    expect((await handleGateway(post(chat), "chat", off.d)).status).toBe(200);
  });
});

describe("orchestration endpoints (ADR-0053)", () => {
  it("uses the private engine when it is installed, else the open fallback", () => {
    const installed = existsSync(
      fileURLToPath(new URL("../../../../private/orchestration/src/index.ts", import.meta.url)),
    );
    expect(engine.edition).toBe(installed ? "private" : "open");
  });

  it("runs an agent step with the installed engine, billing every inner call", async () => {
    const g = gateway();
    const res = await handleOrchestration(post(step), "agent", g.d, engine);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; toolCalls: unknown[]; route: string };
    expect(typeof body.reply).toBe("string");
    expect(body.toolCalls).toEqual([]);
    expect(g.upstream.length).toBeGreaterThan(0);
    expect(g.spent["user:1"]).toBeGreaterThan(0);
  });

  it("validates the request, maps refusals and never exposes decision details", async () => {
    const g = gateway();
    expect((await handleOrchestration(post({ phase: "x" }), "agent", g.d, engine)).status).toBe(
      400,
    );
    expect(
      (await handleOrchestration(post(step, "tbh_ai_nope"), "agent", g.d, engine)).status,
    ).toBe(401);
    const refusing: OrchestrationEngine = {
      edition: "open",
      agentStep: async () => {
        throw Object.assign(new Error("no"), { code: "unsafe" });
      },
      orchestrate: async () => {
        throw Object.assign(new Error("down"), { code: "upstream", status: 0 });
      },
    };
    const unsafe = await handleOrchestration(post(step), "agent", g.d, refusing);
    expect(unsafe.status).toBe(422);
    expect(((await unsafe.json()) as { code: string }).code).toBe("unsafe_request");
    const slow = await handleOrchestration(
      post({ task: "t", input: "x", timeoutMs: 5000 }),
      "orchestrate",
      g.d,
      refusing,
    );
    expect(slow.status).toBe(504);
  });

  it("the engine can only call allowed models", async () => {
    const g = gateway();
    const sneaky: OrchestrationEngine = {
      edition: "open",
      agentStep: async (_r, io) => {
        await io.chat(
          { model: "some-other-model", messages: [{ role: "user", content: "x" }] },
          1000,
        );
        throw new Error("unreachable");
      },
      orchestrate: async () => {
        throw new Error("unused");
      },
    };
    expect((await handleOrchestration(post(step), "agent", g.d, sneaky)).status).toBe(400);
    expect(g.upstream).toHaveLength(0);
    expect(gatewayRoutes(g.d.config).map((r) => r.name)).toEqual(["fast", "balanced", "frontier"]);
  });
});

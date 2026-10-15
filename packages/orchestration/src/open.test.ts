import { describe, expect, it } from "vitest";
import { openEngine } from "./open.js";
import type { ChatCall, EngineIO } from "./types.js";

function io(answer: { text?: string; tool?: string }): EngineIO & { calls: ChatCall[] } {
  const calls: ChatCall[] = [];
  return {
    calls,
    routes: [
      { name: "fast", model: "small" },
      { name: "balanced", model: "mid" },
    ],
    structurerModel: "small",
    chat: async (call) => {
      calls.push(call);
      return {
        text: answer.text ?? "",
        toolCalls: answer.tool
          ? [{ id: "c1", type: "function", function: { name: answer.tool, arguments: "{}" } }]
          : [],
        inputTokens: 3,
        outputTokens: 2,
      };
    },
    validate: () => true,
  };
}

const tools = [
  { name: "check", description: "free times", parameters: { type: "object" }, irreversible: false },
];

describe("open orchestration engine (public fallback)", () => {
  it("offers every tool on the default route and returns the model's tool calls", async () => {
    const fake = io({ tool: "check" });
    const r = await openEngine.agentStep(
      {
        phase: "start",
        instructions: "Help.",
        tools,
        messages: [{ role: "user", content: "free?" }],
        now: "2026-10-15T00:00:00Z",
        timeoutMs: 10_000,
      },
      fake,
    );
    expect(openEngine.edition).toBe("open");
    expect(r.toolCalls.map((c) => c.function.name)).toEqual(["check"]);
    expect(r.route).toBe("balanced");
    expect(fake.calls[0]?.tools?.map((t) => t.function.name)).toEqual(["check"]);
    expect(r.decision).toBe("none");
  });

  it("answers plain and structured requests with one call", async () => {
    const fake = io({ text: '{"a":1}' });
    const r = await openEngine.orchestrate(
      { task: "t", input: "x", schema: { type: "object" }, timeoutMs: 10_000 },
      fake,
    );
    expect(r.text).toBe('{"a":1}');
    expect(fake.calls[0]?.response_format).toEqual({ type: "json_object" });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  NONE_OPTION,
  choice,
  choiceConfidence,
  createJevDecider,
  createOpenDecider,
  FallbackDecider,
  noul,
  noulConfidence,
  route,
} from "./index.js";
import type { Questions } from "./types.js";

type Body = { state: unknown; model: string; questions: Questions };

/** Fake /v1/systemone: picks the first option of every Choice, 0.9 for every Noul. */
function fakeSystemOne(calls: Body[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    calls.push(body);
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      if (q.type === "choice") {
        const labels = Object.keys(q.criteria);
        const probabilities = Object.fromEntries(
          labels.map((l, i) => [l, i === 0 ? 0.6 : 0.4 / (labels.length - 1)]),
        );
        answers[id] = { type: "choice", choice: labels[0], confidence: 0.5, probabilities };
      }
    }
    return new Response(
      JSON.stringify({ model: body.model, answers, usage: { input_tokens: 10, output_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

describe("question builders", () => {
  it("adds a none-of-the-above option by default", () => {
    const q = choice("Pick", { a: null, b: null });
    expect(Object.keys(q.criteria)).toEqual(["a", "b", NONE_OPTION]);
    expect(
      Object.keys(choice("Pick", { a: null, b: null }, { includeNone: false }).criteria),
    ).toEqual(["a", "b"]);
  });
});

describe("JevDecider", () => {
  it("sends every question in ONE request with the pinned model", async () => {
    const calls: Body[] = [];
    const d = createJevDecider("test-key", fakeSystemOne(calls) as unknown as typeof fetch);
    const res = await d.ask(
      { capability: "auth.session" },
      {
        best_fit: choice("Best candidate?", { a: null, b: null }),
        meets_acceptance: noul("Meets the acceptance criteria"),
        security_concern: noul("Introduces an unmitigated security risk"),
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("jev-1.13.0");
    expect(Object.keys(calls[0]?.questions ?? {})).toHaveLength(3);
    expect(res.meta.requests).toBe(1);
    expect(res.answers.meets_acceptance).toEqual({ type: "noul", noul: 0.9 });
  });

  it("rejects invalid questions before any network call", async () => {
    const calls: Body[] = [];
    const d = createJevDecider("k", fakeSystemOne(calls) as unknown as typeof fetch);
    await expect(
      d.ask("s", { bad: { type: "score", criteria: ["only"] } } as never),
    ).rejects.toThrow(/levels/);
    expect(calls).toHaveLength(0);
  });
});

describe("OpenDecider (Quyet, max 10 options)", () => {
  it("splits a 20-option Choice into a batched two-level beam (2 requests total)", async () => {
    const calls: Body[] = [];
    const d = createOpenDecider(
      "http://127.0.0.1:1",
      "m",
      fakeSystemOne(calls) as unknown as typeof fetch,
    );
    const criteria = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i}`, null]));
    const res = await d.ask("state", {
      pick: choice("Best?", criteria, { includeNone: false }),
      flag: noul("Is it flagged?"),
    });
    expect(calls).toHaveLength(2);
    // Stage 1 batches both group questions and the Noul in the same request.
    expect(Object.keys(calls[0]?.questions ?? {}).sort()).toEqual(["flag", "pick::g0", "pick::g1"]);
    // Stage 2 has ≤ 10 finalists.
    const finalists = Object.keys((calls[1]?.questions.pick as { criteria: object }).criteria);
    expect(finalists.length).toBeLessThanOrEqual(10);
    const pick = res.answers.pick;
    expect(pick?.type).toBe("choice");
    if (pick?.type === "choice") expect(Object.keys(pick.probabilities)).toHaveLength(20);
    expect(res.meta.requests).toBe(2);
  });

  it("refuses states over its token budget instead of letting the model truncate", async () => {
    const d = createOpenDecider(
      "http://127.0.0.1:1",
      "m",
      fakeSystemOne([]) as unknown as typeof fetch,
    );
    await expect(d.ask("x".repeat(40_000), { q: noul("?") })).rejects.toThrow(RangeError);
  });
});

describe("confidence normalization", () => {
  it("recomputes Choice confidence with the documented formula regardless of backend", async () => {
    const d = createOpenDecider(
      "http://127.0.0.1:1",
      "m",
      fakeSystemOne([]) as unknown as typeof fetch,
    );
    const res = await d.ask("s", {
      pick: choice("?", { a: null, b: null }, { includeNone: false }),
    });
    const pick = res.answers.pick;
    // fake returns p = {a: 0.6, b: 0.4} with confidence 0.5; documented formula gives (0.6-0.5)/0.5 = 0.2
    if (pick?.type === "choice") expect(pick.confidence).toBeCloseTo(0.2);
  });
});

describe("FallbackDecider", () => {
  it("uses the fallback and records it when the primary fails", async () => {
    const failing = vi.fn(async () => new Response("boom", { status: 400 }));
    const primary = createJevDecider("k", failing as unknown as typeof fetch);
    const fallback = createOpenDecider(
      "http://127.0.0.1:1",
      "m",
      fakeSystemOne([]) as unknown as typeof fetch,
    );
    const res = await new FallbackDecider(primary, fallback).ask("s", { q: noul("?") });
    expect(res.meta.backend).toBe("open");
    expect(res.meta.fallbackFrom).toBe("jev");
  });
});

describe("confidence", () => {
  it("matches the documented formulas", () => {
    expect(choiceConfidence({ a: 1, b: 0 })).toBe(1);
    expect(choiceConfidence({ a: 0.5, b: 0.5 })).toBe(0);
    expect(noulConfidence(0.5)).toBe(0);
    expect(route(0.95, { act: 0.9, review: 0.6 })).toBe("act");
    expect(route(0.7, { act: 0.9, review: 0.6 })).toBe("review");
    expect(route(0.2, { act: 0.9, review: 0.6 })).toBe("escalate");
  });
});

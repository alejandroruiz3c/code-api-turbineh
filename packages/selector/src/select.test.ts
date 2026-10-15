import type { Decider, Decision, Questions } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { selectComponents, type CandidateCard } from "./index.js";

const card = (id: string, provides: string): CandidateCard => ({
  id,
  provides: [provides],
  status: "approved",
  pkg: { name: id, version: "1.0.0" },
  license: { declared: "MIT", detected: "MIT" },
  peer: {},
  conflicts: [],
  requires: [],
  card: `${id} card`,
});

/** Fake decider: prefers ids containing "good", says "bad" ones do not cover and are risky. */
function fakeDecider(calls: Questions[]): Decider {
  return {
    id: "jev",
    capabilities: { maxChoiceOptions: 255, maxScoreLevels: 10, maxStateTokens: 30000 },
    async ask<Q extends Questions>(_state: unknown, questions: Q) {
      calls.push(questions);
      const answers: Record<string, unknown> = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.type === "choice") {
          const opts = Object.keys(q.criteria);
          const probabilities = Object.fromEntries(
            opts.map((o) => [o, o.includes("good") ? 0.9 : 0.1 / opts.length]),
          );
          answers[k] = {
            type: "choice",
            choice: opts.find((o) => o.includes("good")) ?? opts[0],
            confidence: 0.8,
            probabilities,
          };
        } else {
          const bad = k.includes("bad");
          answers[k] = {
            type: "noul",
            noul: k.startsWith("covers") ? (bad ? 0.1 : 0.9) : bad ? 0.8 : 0.05,
          };
        }
      }
      return {
        answers,
        meta: {
          backend: "jev",
          model: "jev-1.13.0",
          latencyMs: 90,
          requests: 1,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      } as unknown as Decision<Q>;
    },
  };
}

describe("selectComponents", () => {
  it("sends the whole build as ONE batched request and ranks eligible candidates", async () => {
    const calls: Questions[] = [];
    const res = await selectComponents(
      {
        app: { recipe: "saas-crud", summary: "x", acceptance_criteria: [] },
        candidates: {
          "auth.session": [
            card("auth.session.bad", "auth.session"),
            card("auth.session.good", "auth.session"),
          ],
          "data.orm": [card("data.orm.good", "data.orm")],
          "payments.checkout": [],
        },
      },
      fakeDecider(calls),
    );
    expect(calls).toHaveLength(1);
    // 2 choices + 3 candidates × 2 nouls
    expect(Object.keys(calls[0] ?? {})).toHaveLength(8);
    const auth = res.decisions.find((d) => d.capability === "auth.session");
    expect(auth?.ranked.map((c) => c.id)).toEqual(["auth.session.good"]);
    expect(res.decisions.find((d) => d.capability === "payments.checkout")?.trigger).toBe("T1");
  });

  it("raises T2 when no candidate covers the capability safely", async () => {
    const res = await selectComponents(
      {
        app: { recipe: "saas-crud", summary: "x", acceptance_criteria: [] },
        candidates: { "ui.charts": [card("ui.charts.bad", "ui.charts")] },
      },
      fakeDecider([]),
    );
    expect(res.decisions[0]?.trigger).toBe("T2");
  });

  it("keeps an approved provider the decider judged as not covering (F09): the Backup Coder never rewrites it", async () => {
    // The decider says "no" to coverage but nothing is risky: approved manifests declare the capability.
    const decider: Decider = {
      ...fakeDecider([]),
      async ask<Q extends Questions>(_s: unknown, questions: Q) {
        const answers: Record<string, unknown> = {};
        for (const [k, q] of Object.entries(questions))
          answers[k] =
            q.type === "choice"
              ? {
                  type: "choice",
                  choice: "jobs.scheduler.croner",
                  confidence: 0.5,
                  probabilities: {
                    "jobs.scheduler.croner": 0.6,
                    "jobs.scheduler.cron-parser": 0.4,
                  },
                }
              : { type: "noul", noul: k.startsWith("covers") ? 0.2 : 0.05 };
        return {
          answers,
          meta: {
            backend: "jev",
            model: "m",
            latencyMs: 1,
            requests: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        } as unknown as Decision<Q>;
      },
    };
    const res = await selectComponents(
      {
        app: { recipe: "saas-crud", summary: "x", acceptance_criteria: [] },
        candidates: {
          "jobs.scheduler": [
            card("jobs.scheduler.cron-parser", "jobs.scheduler"),
            card("jobs.scheduler.croner", "jobs.scheduler"),
          ],
        },
      },
      decider,
    );
    expect(res.decisions[0]?.trigger).toBeNull();
    expect(res.decisions[0]?.catalogueFallback).toBe(true);
    expect(res.decisions[0]?.ranked.map((c) => c.id)).toEqual([
      "jobs.scheduler.croner",
      "jobs.scheduler.cron-parser",
    ]);
  });
});

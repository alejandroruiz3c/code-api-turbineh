import { describe, expect, it } from "vitest";
import { appCandidates, chooseAppPath, type AppChoiceDecider } from "./app-choice.js";

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
const NEXT = { next: "16.0.1", react: "19.2.0" };
const monorepo = {
  "package.json": pkg({}),
  "apps/web/package.json": pkg(NEXT),
  "apps/app/package.json": pkg({ ...NEXT, "drizzle-orm": "0.45.0", "better-auth": "1.3.0" }),
  "packages/ui/package.json": pkg({ react: "19.2.0" }),
};

/** A decider whose engine answers with `answer` (this fake accepts known apps at confidence ≥ 0.75). */
function decider(answer: { choice: string; confidence: number } | Error): AppChoiceDecider & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    chooseApp: async (input) => {
      calls.push(input);
      if (answer instanceof Error) throw answer;
      const known = input.apps.some((a) => a.dir === answer.choice);
      return {
        dir: answer.choice,
        confidence: answer.confidence,
        accepted: known && answer.confidence >= 0.75,
      };
    },
  };
}

describe("which app of a monorepo receives the capability (ADR-0039)", () => {
  it("lists the Next.js apps as candidates", () => {
    expect(appCandidates(monorepo)).toEqual(["apps/app", "apps/web"]);
  });

  it("asks the decider when there are several apps and follows a confident answer", async () => {
    const d = decider({ choice: "apps/app", confidence: 0.9 });
    const r = await chooseAppPath(monorepo, { decider: d, need: "A booking assistant" });
    expect(r).toMatchObject({ appPath: "apps/app", by: "decider", confidence: 0.9 });
    expect(d.calls).toHaveLength(1);
  });

  it("falls back to the heuristic on low confidence, an unknown answer, an error or no decider", async () => {
    for (const d of [
      decider({ choice: "apps/app", confidence: 0.2 }),
      decider({ choice: "apps/other", confidence: 0.9 }),
      decider(new Error("down")),
      null,
    ])
      expect(await chooseAppPath(monorepo, { decider: d })).toMatchObject({
        appPath: "apps/web",
        by: "code",
      });
  });

  it("never asks when the person chose or there is a single app", async () => {
    const d = decider({ choice: "apps/web", confidence: 1 });
    expect(await chooseAppPath(monorepo, { decider: d, preferred: "apps/app" })).toMatchObject({
      appPath: "apps/app",
      by: "person",
    });
    expect(
      await chooseAppPath(
        { "package.json": pkg(NEXT), "packages/config/package.json": pkg({}) },
        { decider: d },
      ),
    ).toMatchObject({ appPath: "", by: "code" });
    expect(d.calls).toHaveLength(0);
  });
});

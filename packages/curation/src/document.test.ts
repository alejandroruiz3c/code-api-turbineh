import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentDocsSchema } from "@turbineh/catalog";
import { describe, expect, it } from "vitest";
import { checkDraft, componentFacts, exampleProblem, importsFrom, type Draft } from "./document.js";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog/components");

const draft: Draft = {
  use_cases: ["Retrying flaky network calls", "Backing off on rate limits"],
  when_to_use: ["A remote call fails transiently"],
  when_not_to_use: [
    { instead: "ops.concurrency.p-limit", why: "You need to limit parallel work" },
    { instead: "ops.made-up.component", why: "Invented alternative" },
  ],
  tradeoffs: ["Adds latency while retrying"],
  interfaces: [
    { name: "withRetry", kind: "component", about: "Bounded retries with jitter" },
    { name: "inventedHelper", kind: "export", about: "Not in the code" },
  ],
  extension_points: [],
  security: ["No network access of its own"],
  guarantees: [
    { claim: "Retries until the operation succeeds", test_title: "retries until success" },
    { claim: "Never retries forever", test_title: "a test that does not exist" },
  ],
  limits: ["At most 10 retries"],
  example: "import { withRetry } from '@/integrations/ops-retry';\nawait withRetry(async () => 1);",
  keywords: ["retry", "backoff", "jitter", "transient errors", "resilience"],
};

describe("documentation step (facts first, claims checked)", () => {
  it("collects facts from code: importable names, glue path, tests, install", async () => {
    const f = await componentFacts(componentsDir, "ops.retry.p-retry", false);
    expect(f.importable["p-retry"]).toEqual(expect.arrayContaining(["pRetry"]));
    expect(f.importable["@/integrations/ops-retry"]).toEqual(expect.arrayContaining(["withRetry"]));
    expect(f.tests.map((t) => t.title)).toContain("retries until success");
  });

  it("drops every claim the code does not support and keeps the rest", async () => {
    const f = await componentFacts(componentsDir, "ops.retry.p-retry", false);
    const { docs, dropped } = checkDraft(f, draft, { by: "test-model", at: "2026-10-13" });
    expect(docs.interfaces.map((i) => i.name)).toEqual(["withRetry"]);
    expect(docs.interfaces[0]?.kind).toBe("export");
    expect(docs.guarantees).toEqual([
      {
        claim: "Retries until the operation succeeds",
        test: { file: "contract.test.ts", title: "retries until success" },
      },
    ]);
    expect(docs.when_not_to_use.map((w) => w.instead)).toEqual(["ops.concurrency.p-limit"]);
    expect(docs.dependencies).toMatchObject({ package: "p-retry", version: "8.0.1" });
    expect(dropped).toHaveLength(3);
    expect(componentDocsSchema.safeParse(docs).success).toBe(true);
    expect(docs.generated.sections).toContain("example");
  });

  it("rejects examples that import what the component does not provide", () => {
    const importable = { "p-retry": ["pRetry"], "@/integrations/ops-retry": ["withRetry"] };
    expect(exampleProblem("import { withRetry } from 'p-retry';", importable)).toMatch(
      /withRetry not exported by p-retry/,
    );
    expect(exampleProblem("import x from 'lodash';", importable)).toMatch(/does not provide/);
    expect(exampleProblem("import pRetry from 'p-retry';", importable)).toBeNull();
  });

  it("reads members of namespace imports", () => {
    expect(
      importsFrom(
        'import * as S from "@radix-ui/react-switch";\nh(S.Root, null, h(S.Thumb));',
        "@radix-ui/react-switch",
      ).sort(),
    ).toEqual(["Root", "Thumb"]);
  });
});

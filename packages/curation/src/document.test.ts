import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentDocsSchema } from "@turbineh/catalog";
import { describe, expect, it } from "vitest";
import {
  checkDraft,
  componentFacts,
  exampleProblem,
  importsFrom,
  repairImports,
  type Draft,
} from "./document.js";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog/components");

const draft: Draft = {
  title: "Retries with backoff",
  summary: "Wraps an async operation and retries it with exponential backoff and jitter.",
  use_cases: ["Retrying flaky network calls", "Backing off on rate limits"],
  when_to_use: ["A remote call fails transiently"],
  when_not_to_use: [
    { instead: "ops.concurrency.p-limit", why: "You need to limit parallel work" },
    { instead: "ops.made-up.component", why: "Invented alternative" },
  ],
  tradeoffs: [{ choice: "Exponential backoff", gain: "Gentle on servers", cost: "Adds latency" }],
  interfaces: [
    { name: "withRetry", about: "Bounded retries with jitter" },
    { name: "inventedHelper", about: "Not in the code" },
  ],
  extension_points: [{ what: "Custom delays", where: "withRetry options", how: "Pass minTimeout" }],
  security: ["No network access of its own"],
  guarantees: [
    { claim: "Retries until the operation succeeds", test_title: "retries until success" },
    { claim: "Never retries forever", test_title: "a test that does not exist" },
  ],
  limits: ["At most 10 retries"],
  example: "import { withRetry } from '@/integrations/ops-retry';\nawait withRetry(async () => 1);",
  keywords: ["retry", "backoff", "jitter", "transient errors", "resilience"],
  synonyms: [{ term: "retry", also: ["re-attempt", "backoff"] }],
};

describe("documentation step (facts first, claims checked)", () => {
  it("collects facts from code: importable names with real signatures, tests, install", async () => {
    const f = await componentFacts(componentsDir, "ops.retry.p-retry", false);
    expect(f.importable["p-retry"]).toEqual(expect.arrayContaining(["pRetry"]));
    expect(f.importable["@/integrations/ops-retry"]).toEqual(expect.arrayContaining(["withRetry"]));
    expect(f.signatures.withRetry?.signature).toMatch(/^(async )?function withRetry/);
    expect(f.tests.map((t) => t.title)).toContain("retries until success");
  });

  it("writes a guide (turbineh.guide/v0.1) keeping only what the code supports", async () => {
    const f = await componentFacts(componentsDir, "ops.retry.p-retry", false);
    const { docs, dropped } = checkDraft(f, draft, { by: "test-model", at: "2026-10-13" });
    expect(docs.interfaces.map((i) => i.name)).toEqual(["withRetry"]);
    expect(docs.interfaces[0]?.where).toBe("@/integrations/ops-retry");
    expect(docs.guarantees).toEqual([
      {
        claim: "Retries until the operation succeeds",
        test: "contract.test.ts › retries until success",
      },
    ]);
    expect(docs.avoid_when).toEqual([
      "You need to limit parallel work — use ops.concurrency.p-limit",
    ]);
    expect(docs.compatibility).toMatchObject({ package: "p-retry@8.0.1" });
    expect(docs.config[0]?.name).toBe("install");
    expect(dropped).toHaveLength(3);
    expect(componentDocsSchema.safeParse(docs).success).toBe(true);
    expect(docs.generated?.sections).toContain("example");
  });

  it("rejects examples that import what the component does not provide", () => {
    const importable = { "p-retry": ["pRetry"], "@/integrations/ops-retry": ["withRetry"] };
    expect(exampleProblem("import { withRetry } from 'p-retry';", importable)).toMatch(
      /withRetry not exported by p-retry/,
    );
    expect(exampleProblem("import x from 'lodash';", importable)).toMatch(/does not provide/);
    expect(exampleProblem("import pRetry from 'p-retry';", importable)).toBeNull();
  });

  it("corrects only the import path of names the component really exports", () => {
    const importable = {
      "@/lib/billing": ["stripePost", "billingEnv"],
      "@/lib/billing-rules": ["hasPaidAccess"],
    };
    expect(
      repairImports("import { stripePost, hasPaidAccess } from 'turbineh/payments';", importable),
    ).toBe(
      'import { stripePost } from "@/lib/billing";\nimport { hasPaidAccess } from "@/lib/billing-rules";',
    );
    expect(repairImports("import { invented } from 'x';", importable)).toBe(
      "import { invented } from 'x';",
    );
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

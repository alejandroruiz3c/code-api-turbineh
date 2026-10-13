import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readUseCases, renderUseCases } from "../scripts/use-cases-source.js";
import {
  buildPlan,
  compatibility,
  createZip,
  detectStack,
  flowResult,
  flowState,
  PACKAGE_LAYOUT,
  productText,
  projectDependencies,
  readZip,
  searchCapabilities,
  USE_CASES,
  writeComponentPackage,
  writeFlowPackage,
  zipDirectory,
} from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const nextPkg = JSON.stringify({
  dependencies: { next: "^15.2.0", react: "19.0.0", "drizzle-orm": "0.44.0" },
  devDependencies: { typescript: "~5.9.2" },
  engines: { node: ">=22" },
});

describe("stack detection", () => {
  it("reads framework, language, package manager and versions from manifests", () => {
    const s = detectStack({
      files: { "package.json": nextPkg, "pnpm-lock.yaml": "", "tsconfig.json": "{}" },
    });
    expect(s).toMatchObject({
      language: "typescript",
      framework: "nextjs",
      packageManager: "pnpm",
      source: "files",
    });
    expect(s.versions).toMatchObject({ next: "15.2.0", typescript: "5.9.2", node: "22" });
    expect(s.adaptationPending).toBe(false);
  });

  it("marks a declared stack as pending adaptation and explains it", () => {
    const s = detectStack({
      stack: { language: "TypeScript", framework: "nextjs", versions: { next: "16" } },
    });
    expect(s.adaptationPending).toBe(true);
    expect(compatibility(s, "use_case").missing.join(" ")).toMatch(
      /Adaptation to your concrete project is pending/,
    );
  });

  it("explains incompatibilities instead of failing", () => {
    expect(
      compatibility(detectStack({ files: { "requirements.txt": "django" } }), "use_case")
        .compatible,
    ).toBe(false);
    const old = detectStack({
      files: {
        "package.json": JSON.stringify({ dependencies: { next: "13.5.0" } }),
        "tsconfig.json": "{}",
      },
    });
    expect(compatibility(old, "use_case").incompatibilities[0]).toMatch(/Next.js 13.5.0/);
    expect(
      compatibility(
        detectStack({ files: { "package.json": nextPkg, "tsconfig.json": "{}" } }),
        "use_case",
      ).compatible,
    ).toBe(true);
  });
});

describe("search by need", () => {
  const components = [
    {
      id: "ai.orchestrator.turbineh",
      version: "1.0.0",
      category: "ai",
      provides: ["ai.orchestrator"],
      license: "Apache-2.0",
      purl: "pkg:generic/turbineh/orchestrator@1.0.0",
      does: "Routes any AI inference through TurbineH orchestration",
    },
    {
      id: "payments.checkout.stripe",
      version: "1.0.0",
      category: "payments",
      provides: ["payments.checkout"],
      license: "MIT",
      purl: "pkg:npm/stripe@1.0.0",
      does: "Card payments with Stripe Checkout",
    },
  ];
  it("finds use cases first and the components that cover the need", () => {
    const r = searchCapabilities("support agent with a knowledge base", components);
    expect(r[0]?.id).toBe("ai-agents");
    expect(searchCapabilities("reservas para una clínica / booking", components)[0]?.id).toBe(
      "bookings",
    );
    expect(
      searchCapabilities("checkout payments", components).some(
        (x) => x.id === "payments.checkout.stripe",
      ),
    ).toBe(true);
  });
});

describe("plan", () => {
  it("lists components, files, config, estimate and what needs a person", () => {
    const stack = detectStack({ files: { "package.json": nextPkg, "tsconfig.json": "{}" } });
    const plan = buildPlan({
      id: "pl_1",
      need: "AI booking agent for a physio clinic",
      slug: "physio-booking-agent",
      stack,
      useCase: USE_CASES.find((u) => u.id === "ai-agents") ?? null,
      components: [
        {
          id: "ai.orchestrator.turbineh",
          version: "1.0.0",
          license: "Apache-2.0",
          purl: "pkg:generic/turbineh/x",
          capability: "ai.orchestrator",
          why: "Required by the flow",
        },
      ],
      gaps: ["ui.map"],
      decisions: [],
      dependencies: [{ name: "zod", version: "4.6.5" }],
      envKeys: ["DATABASE_URL", "TURBINEH_AI_TOKEN"],
      preferences: {
        changePolicy: { autoApply: "never", allowDependencyChanges: false, allowNewEnv: true },
      },
    });
    expect(plan.state).toBe("planned");
    expect(plan.files.map((f) => f.path)).toContain(
      "turbineh/physio-booking-agent/agent/INTEGRATE.md",
    );
    expect(plan.config.map((c) => c.name)).toContain("TURBINEH_AI_TOKEN");
    expect(plan.needsApproval.join(" ")).toMatch(/ui.map/);
    expect(plan.needsApproval.join(" ")).toMatch(/policy does not allow new dependencies/);
    expect(plan.estimate.tokens).toBeGreaterThan(0);
  });

  it("plans only new dependencies, flags major conflicts and lists each component once", () => {
    const stack = detectStack({ files: { "package.json": nextPkg, "tsconfig.json": "{}" } });
    const pack = {
      id: "security.pack.turbineh",
      version: "0.1.0",
      license: "Apache-2.0",
      purl: "pkg:generic/turbineh/security-pack@0.1.0",
    };
    const plan = buildPlan({
      id: "pl_2",
      need: "Bookings for a physio clinic",
      slug: "physio",
      stack,
      useCase: USE_CASES.find((u) => u.id === "bookings") ?? null,
      components: [
        { ...pack, capability: "security.headers", why: "Best verified fit for security headers" },
        { ...pack, capability: "security.rate-limit", why: "Required by the flow for rate limits" },
      ],
      gaps: [],
      decisions: [],
      dependencies: [
        { name: "next", version: "16.3.8" },
        { name: "react", version: "19.3.0" },
        { name: "zod", version: "4.6.5" },
      ],
      projectDependencies: projectDependencies({ "package.json": nextPkg }),
      notCovered: ["The AI part of the need"],
    });
    expect(plan.dependencies).toEqual([{ name: "zod", version: "4.6.5" }]);
    expect(plan.files.find((f) => f.path === "package.json")?.why).toBe(
      "Adds 1 verified dependency",
    );
    expect(plan.compatible).toBe(true);
    expect(plan.needsApproval.join(" ")).toMatch(/Incompatibility: next/);
    expect(plan.incompatibilities.join(" ")).toMatch(/next: .*16\.3\.8.*15\.2\.0/);
    expect(plan.components).toHaveLength(1);
    expect(plan.components[0]?.why).toMatch(/security headers; required by the flow/);
    expect(plan.missing).toContain("The AI part of the need");
  });
});

describe("states and results", () => {
  const row = (over: Partial<Parameters<typeof flowState>[0]>) => ({
    id: "b1",
    status: "done",
    options: {},
    metrics: {},
    artifact: null,
    error: null,
    ...over,
  });
  it("uses precise states", () => {
    expect(flowState(row({ status: "compiling", options: { mode: "plan" } }))).toBe("planning");
    expect(flowState(row({ options: { mode: "plan" } }))).toBe("planned");
    expect(flowState(row({ status: "verifying", options: { mode: "generate" } }))).toBe(
      "generating",
    );
    expect(flowState(row({ metrics: { verify: [{ name: "lint", ok: true }] } }))).toBe("verified");
    expect(flowState(row({ metrics: { verify: [{ name: "e2e", ok: false }] } }))).toBe("generated");
    expect(
      flowState(
        row({
          metrics: {
            verify: [{ name: "lint", ok: true }],
            integrations: [{ id: "i1", state: "integrated", at: "x" }],
          },
        }),
      ),
    ).toBe("integrated");
  });

  it("puts what works and what is missing first, with actionable errors", () => {
    const r = flowResult(
      row({
        metrics: {
          verify: [{ name: "lint", ok: true }],
          plan: {
            config: [{ kind: "env", name: "STRIPE_SECRET_KEY", why: "x", satisfied: false }],
            capability: { id: "shop" },
          },
        },
      }),
      { zipUrl: "z", manifestUrl: null },
    );
    expect(r.state).toBe("verified");
    expect(r.needs[0]?.name).toBe("STRIPE_SECRET_KEY");
    expect(r.agentInstructions).toMatch(/agent\/INTEGRATE.md/);
    const failed = flowResult(row({ status: "failed", error: "e2e failed" }), {
      zipUrl: null,
      manifestUrl: null,
    });
    expect(failed.errors[0]).toMatchObject({ code: "generation_failed" });
    expect(failed.errors[0]?.action).toBeTruthy();
  });
});

describe("capability package", () => {
  it("has the documented layout for a complete flow and for components only", () => {
    const app = mkdtempSync(join(tmpdir(), "app-"));
    const w = (p: string, c: string) => {
      mkdirSync(dirname(join(app, p)), { recursive: true });
      writeFileSync(join(app, p), c);
    };
    w("package.json", JSON.stringify({ dependencies: { zod: "4.6.5" } }));
    w(".env.example", "DATABASE_URL=\nSTRIPE_SECRET_KEY=\n");
    w("src/app/dashboard/bookings/page.tsx", "export default function P() {}\n");
    w("src/entities/bookings/actions.ts", "export {}\n");
    w("tests/unit/a.test.ts", "export {}\n");
    execFileSync("git", ["init", "-q"], { cwd: app });
    execFileSync("git", ["add", "-A"], { cwd: app });
    const out = mkdtempSync(join(tmpdir(), "pkg-"));
    const info = {
      slug: "physio-bookings",
      name: "Physio bookings",
      need: "bookings for a physio clinic",
      planId: "b1",
      state: "verified" as const,
      summary: "Bookings decided by JEV by TypeSafe",
      components: [
        { id: "x.y", version: "1.0.0", license: "MIT", purl: "pkg:npm/x@1.0.0", capability: "x.y" },
      ],
      checks: [{ name: "lint", ok: true }],
    };
    const dir = writeFlowPackage(app, out, info);
    for (const p of PACKAGE_LAYOUT) expect(existsSync(join(dir, p)), p).toBe(true);
    expect(existsSync(join(dir, "examples/app/package.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      environment: string[];
      entryPoints: string[];
      summary: string;
    };
    expect(manifest.environment).toEqual(["DATABASE_URL", "STRIPE_SECRET_KEY"]);
    expect(manifest.entryPoints).toContain("src/entities/bookings/actions.ts");
    expect(manifest.summary).not.toMatch(/JEV|TypeSafe/);

    const comp = mkdtempSync(join(tmpdir(), "comp-"));
    writeFileSync(join(comp, "glue.ts"), "export const ok = 1;\n");
    writeFileSync(join(comp, "contract.test.ts"), "export {}\n");
    const cdir = writeComponentPackage(
      [
        {
          id: "ai.json-repair.jsonrepair",
          version: "1.0.0",
          license: "ISC",
          purl: "pkg:npm/jsonrepair@3.15.0",
          capability: "ai.json-repair",
          dir: comp,
          does: "Repairs JSON",
        },
      ],
      out,
      { ...info, slug: "json-tools" },
    );
    for (const p of PACKAGE_LAYOUT) expect(existsSync(join(cdir, p)), p).toBe(true);
    expect(JSON.parse(readFileSync(join(cdir, "manifest.json"), "utf8")).dependencies).toEqual({
      jsonrepair: "3.15.0",
    });
  });

  it("zips and unzips byte for byte and refuses unsafe paths", () => {
    const d = mkdtempSync(join(tmpdir(), "z-"));
    mkdirSync(join(d, "a"));
    writeFileSync(join(d, "a", "x.txt"), "hello ñ\n".repeat(50));
    const entries = readZip(zipDirectory(d, "cap"));
    expect(entries.map((e) => e.path)).toEqual(["cap/a/x.txt"]);
    expect(entries[0]?.data.toString()).toBe("hello ñ\n".repeat(50));
    expect(() => readZip(createZip([{ path: "../evil", data: Buffer.from("x") }]))).toThrow(
      /unsafe/,
    );
  });

  it("product texts never name third-party engines", () => {
    expect(productText("JEV by TypeSafe AI decides; Quyet is the open alternative")).toBe(
      "TurbineH orchestration decides; TurbineH open decider is the open alternative",
    );
  });
});

describe("use-case index", () => {
  it("is in sync with catalog/recipes (run `pnpm --filter @turbineh/engine gen`)", () => {
    expect(readFileSync(join(root, "packages/engine/src/use-cases.generated.ts"), "utf8")).toBe(
      renderUseCases(readUseCases(join(root, "catalog/recipes"))),
    );
  });
});

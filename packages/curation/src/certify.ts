import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalErrors, validateManifest, type ComponentManifest } from "@turbineh/catalog";
import { sandbox } from "@turbineh/verifier";
import { parse, stringify } from "yaml";

export interface CertifyResult {
  id: string;
  passed: boolean;
  approved: boolean;
  reason: string;
}

/** Test harness versions (ADR-0002). React is only used by UI component contracts (server rendering). */
const HARNESS = { vitest: "5.0.2", vite: "8.3.1", react: "19.3.0", "react-dom": "19.3.0" };

/**
 * Certifies components with their contract tests:
 *  1. one workspace with every package under test + vitest (dependency install is the only networked step),
 *  2. contract tests run in the sandbox with --network none,
 *  3. a component becomes `approved` only if its contract passed AND the deterministic approval gate passes
 *     (allowed licence, no unmitigated high/critical advisory, tested evidence).
 */
export async function certify(
  ids: string[],
  componentsDir: string,
  evidencePath: string,
  today: string,
): Promise<CertifyResult[]> {
  const work = mkdtempSync(join(tmpdir(), "turbineh-certify-"));
  const manifests = new Map<string, ComponentManifest>();
  const deps: Record<string, string> = {};
  mkdirSync(join(work, "tests"));
  for (const id of ids) {
    const m = parse(
      readFileSync(join(componentsDir, id, "component.yaml"), "utf8"),
    ) as ComponentManifest & { source: { purl: string } };
    manifests.set(id, m);
    const purl = /^pkg:npm\/(.+)@([^@]+)$/.exec(m.source.purl);
    if (purl) deps[purl[1] as string] = purl[2] as string;
    const contract = join(componentsDir, id, "contract.test.ts");
    if (existsSync(contract)) cpSync(contract, join(work, "tests", `${id}.test.ts`));
  }
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify(
      {
        name: "turbineh-certify",
        private: true,
        type: "module",
        dependencies: { ...deps, react: HARNESS.react, "react-dom": HARNESS["react-dom"] },
        devDependencies: { vitest: HARNESS.vitest, vite: HARNESS.vite },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(work, "vitest.config.ts"),
    'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["tests/*.test.ts"], environment: "node", testTimeout: 20000 } });\n',
  );

  const install = await sandbox(
    work,
    "pnpm install --config.strict-peer-dependencies=false 2>&1 | tail -5",
    { network: "bridge", env: {} },
  );
  if (install.code !== 0) throw new Error(`install failed: ${install.tail}`);
  const run = await sandbox(
    work,
    "pnpm exec vitest run --reporter=json --outputFile=results.json > /dev/null 2>&1; echo exit=$?",
    { network: "none", env: {} },
  );
  const results = existsSync(join(work, "results.json"))
    ? (JSON.parse(readFileSync(join(work, "results.json"), "utf8")) as {
        testResults: {
          name: string;
          status: string;
          message?: string;
          assertionResults?: { status: string; failureMessages?: string[] }[];
        }[];
      })
    : { testResults: [] };

  const out: CertifyResult[] = [];
  const evidence: Record<string, unknown> = {
    date: today,
    harness: HARNESS,
    sandbox: "install with network (no secrets), tests with --network none",
    runTail: run.tail,
    components: {},
  };
  for (const [id, m] of manifests) {
    const file = results.testResults.find((r) => r.name.endsWith(`/tests/${id}.test.ts`));
    const passed = file?.status === "passed";
    const failure = [
      file?.message,
      ...(file?.assertionResults ?? []).flatMap((a) => a.failureMessages ?? []),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 800);
    (evidence.components as Record<string, unknown>)[id] = {
      purl: (m.source as { purl: string }).purl,
      passed,
      message: failure,
    };
    if (!passed) {
      out.push({
        id,
        passed,
        approved: false,
        reason: file ? `contract failed: ${failure.slice(0, 300)}` : "no contract test",
      });
      continue;
    }
    const candidate: ComponentManifest = {
      ...m,
      status: "approved",
      quality: {
        tests: {
          command: "contract.test.ts (vitest, sandbox --network none)",
          passed: true,
          date: today,
        },
      },
      evidence: [
        ...m.evidence.filter((e) => e.origin !== "tested" || !e.claim.startsWith("Contract")),
        {
          claim: "Contract tests pass in the sandbox without network",
          origin: "tested",
          ref: evidencePath,
        },
      ],
      relations: { ...m.relations, tested_with: ["contract-harness"] },
    };
    const gate = approvalErrors(candidate);
    const schema = validateManifest(candidate);
    if (gate.length === 0 && schema.ok) {
      writeFileSync(
        join(componentsDir, id, "component.yaml"),
        stringify(candidate, { lineWidth: 120 }),
      );
      out.push({ id, passed, approved: true, reason: "approved" });
    } else {
      const m2 = {
        ...m,
        quality: {
          tests: {
            command: "contract.test.ts (vitest, sandbox --network none)",
            passed: true,
            date: today,
          },
        },
      };
      writeFileSync(join(componentsDir, id, "component.yaml"), stringify(m2, { lineWidth: 120 }));
      out.push({
        id,
        passed,
        approved: false,
        reason: `approval gate: ${[...gate, ...schema.errors].join("; ")}`,
      });
    }
  }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  return out;
}

/** Re-runs the same verify() on existing baseline outputs (after rule fixes), so the comparison uses one gate. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { verify } from "@turbineh/verifier";

const root = join(import.meta.dirname, "../..");
const base = join(root, "builds/baseline");
const out: Record<string, unknown> = {};
for (const d of readdirSync(base).sort()) {
  const v = await verify(join(base, d));
  out[d.replace(/-\d+$/, "")] = {
    green: v.ok,
    failed: v.steps.filter((s) => !s.ok).map((s) => s.name),
    staticErrors: v.findings.static
      .filter((f) => f.severity === "ERROR")
      .map((f) => `${f.rule} ${f.path}:${f.line}`),
    advisories: v.findings.advisories.map((a) => `${a.pkg} ${a.severity} ${a.scope}`),
    blockedLicences: [...new Set(v.findings.licenses)],
  };
  console.log(d, v.ok);
}
console.log(JSON.stringify(out, null, 2));

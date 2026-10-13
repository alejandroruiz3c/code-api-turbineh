import type { GuideFailure } from "@turbineh/assembler";
import type { FailureAttribution } from "@turbineh/integrator";
import {
  deliveryKind,
  gateFindings,
  rerunCommand,
  testTitle,
  type DeliveryKind,
  type VerifyResult,
} from "@turbineh/verifier";

/**
 * Delivery of a build whose gate failed (ADR-0037 §D1). Everything here is decided by code from the gate result:
 * what is delivered (code + report, or only the report), the exact failures and the suggested fix.
 */
export interface Delivery {
  kind: DeliveryKind;
  verified: boolean;
  checksPassed: number;
  checksTotal: number;
  /** "Delivered, not verified: 10/11 checks passed" — the same words in the API, CLI, UI and package docs. */
  label: string;
  failures: GuideFailure[];
  /** Security/policy findings that block runnable delivery (report_only). */
  blocking: { category: string; rule: string; where: string; message: string }[];
}

const FULL_GATE = "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e";

const ownerLabel = (owner: string | null) => {
  if (!owner) return null;
  const [kind, id] = [owner.slice(0, owner.indexOf(":")), owner.slice(owner.indexOf(":") + 1)];
  switch (kind) {
    case "component":
      return `catalog component \`${id}\` (docs/components/${id}.md)`;
    case "recipe":
      return `the \`${id}\` recipe template`;
    case "entity":
      return `the generated \`${id}\` entity`;
    case "integration":
      return `the integrated library for \`${id}\``;
    case "glue":
      return `the generated glue helper for \`${id}\``;
    case "backup":
      return `the Backup Coder module for \`${id}\``;
    case "rules":
      return `the business rules \`${id}\``;
    default:
      return `\`${owner}\``;
  }
};

/** Deterministic suggested fix for one failure: reproduce, where it lives, who owns it, what to change, re-run. */
export function suggestedFix(f: FailureAttribution, rerun: string): string {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null;
  const owner = ownerLabel(f.owner);
  const subject = f.test ? `The test "${testTitle(f.test)}"` : `The ${f.step} step`;
  const located = where ? ` fails at \`${where}\`` : " fails";
  const ownedBy = owner ? ` (owned by ${owner})` : "";
  const what =
    f.step === "e2e" || f.step === "unit"
      ? "Fix the code it exercises — or the test itself if its assumption does not hold for this app (e.g. a role, a default account or a configured value)"
      : f.step === "typecheck" || f.step === "lint"
        ? "Fix the reported line"
        : f.step === "build"
          ? "Fix the build error (often a missing environment default or a server/client import)"
          : "Fix the dependency or migration error shown";
  return `Reproduce with \`${rerun}\`. ${subject}${located}${ownedBy}. ${what}, then re-run that command and the full gate: \`${FULL_GATE}\`.`;
}

export function deliveryOf(v: VerifyResult, attributed: FailureAttribution[]): Delivery {
  const kind = deliveryKind(v);
  const checksPassed = v.steps.filter((s) => s.ok).length;
  const checksTotal = v.steps.length;
  const failures: GuideFailure[] =
    kind === "verified"
      ? []
      : attributed.map((f) => {
          const rerun = rerunCommand({
            step: f.step,
            test: f.test,
            file: f.file,
            line: f.line,
            message: f.message,
          });
          return {
            step: f.step,
            test: f.test,
            where: f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.step,
            owner: f.owner,
            message: f.message,
            rerun,
            fix: suggestedFix(f, rerun),
          };
        });
  const blocking = gateFindings(v)
    .filter((x) => x.blocking && x.category !== "quality")
    .map(({ category, rule, where, message }) => ({ category, rule, where, message }));
  const label =
    kind === "verified"
      ? `Verified: ${checksPassed}/${checksTotal} checks passed`
      : kind === "unverified"
        ? `Delivered, not verified: ${checksPassed}/${checksTotal} checks passed`
        : `Not delivered: a security or policy check blocks (${checksPassed}/${checksTotal} checks passed) — report only`;
  return {
    kind,
    verified: kind === "verified",
    checksPassed,
    checksTotal,
    label,
    failures,
    blocking,
  };
}

/** One-line reason stored as the build's error (API `error`, CLI and UI): label, first failure and its fix. */
export function deliveryReason(d: Delivery): string {
  if (d.kind === "verified") return d.label;
  if (d.kind === "report_only") {
    const b = d.blocking[0];
    return `${d.label}.${b ? ` Blocking ${b.category} finding \`${b.rule}\` at ${b.where}: ${b.message}` : ""}`;
  }
  const f = d.failures[0];
  if (!f) return `${d.label}.`;
  return `${d.label}. Failing: ${f.step}${f.test ? ` "${testTitle(f.test)}"` : ""} at ${f.where}${f.message ? ` — ${f.message}` : ""}. ${f.fix}`;
}

/** Section prepended to TURBINEH_REPORT.md when the package is not verified. */
export function notVerifiedMarkdown(d: Delivery): string {
  if (d.kind === "verified") return "";
  if (d.kind === "report_only") {
    return `# ${d.label}

A security or policy check blocks delivery, so no runnable code was delivered — only this report and SECURITY.md.

${d.blocking.map((b) => `- **${b.category}** \`${b.rule}\` at \`${b.where}\`: ${b.message}`).join("\n") || "- A security scan did not report (fail closed)."}

`;
  }
  return `# ${d.label}

This package is delivered so you can continue, but it is **not verified**: the TurbineH gate failed. Do not present it as
verified. Fix the failure below, then re-run the gate (\`${FULL_GATE}\`).

| Step | Test | Where | Owner | Error |
|---|---|---|---|---|
${d.failures.map((f) => `| ${f.step} | ${f.test ? f.test.replace(/\|/g, "\\|") : "—"} | \`${f.where}\` | ${f.owner ? `\`${f.owner}\`` : "—"} | ${f.message.replace(/\|/g, "\\|") || "—"} |`).join("\n")}

**Suggested fix**

${d.failures.map((f) => `- ${f.fix}`).join("\n")}

`;
}

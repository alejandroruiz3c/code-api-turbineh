import type { Adaptation, CommitStep } from "./adapt.js";
import type { RepoAnalysis } from "./repo-analysis.js";

/**
 * Pull request description for a repository integration (PLAN §16 P5): summary, files, decisions and why,
 * verification results and limits, what the reviewer must configure and how to revert. Plain Markdown, no vendor
 * names (P8). Pure: the worker calls it when the PR opens and again with the verification results.
 */
export interface IntegrationCheck {
  name: string;
  ok: boolean | null; // null = not run (no script, or skipped with a reason)
  detail: string;
  /** For failures: the next step, in plain words. */
  action?: string;
}

export interface PrBodyInput {
  need: string;
  planId: string;
  adaptation: Adaptation;
  analysis: RepoAnalysis;
  commits: { sha: string; message: string }[];
  verification:
    | { state: "running" }
    | { state: "passed" | "failed"; checks: IntegrationCheck[]; seconds: number };
  glue: { path: string; by: "model" | "fallback"; model?: string }[];
  /** Plan page URL in the product area. */
  flowUrl?: string;
}

const mark = (ok: boolean | null) => (ok === null ? "➖ not run" : ok ? "✅ passed" : "❌ failed");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export const PR_MARKER = "<!-- turbineh:integration -->";

export function prTitle(a: Adaptation): string {
  return `TurbineH: integrate ${a.slug}`;
}

export function prBody(input: PrBodyInput): string {
  const { adaptation: a, analysis: r, verification: v } = input;
  const files = a.steps.flatMap((s: CommitStep) => s.files);
  const added = files.filter((f) => f.action === "add");
  const modified = files.filter((f) => f.action === "modify");
  // Capability files are many; list modified files one by one and new ones grouped by folder.
  const groups = new Map<string, number>();
  for (const f of added) {
    const inNs = f.path.startsWith(`${a.namespace}/`);
    const key = inNs
      ? `${a.namespace}/${f.path.slice(a.namespace.length + 1).split("/")[0] ?? ""}`
      : f.path;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const status =
    v.state === "running"
      ? "⏳ **Verification in your project is running** in an isolated sandbox. This description is updated with the results; the pull request stays a draft until every check passes."
      : v.state === "passed"
        ? `✅ **Verified inside your project** (${v.seconds}s, isolated sandbox without secrets): every check below passed.`
        : `❌ **Not verified yet**: ${v.checks.filter((c) => c.ok === false).length} check(s) failed inside your project. The pull request stays a draft; the failures and the next step are listed below.`;
  const lines = [
    PR_MARKER,
    `## Summary`,
    "",
    `Integrates the verified capability **${a.slug}** for: _${esc(input.need)}_.`,
    "",
    status,
    "",
    `- Placed in \`${a.namespace}/\` (self-contained; nothing of yours is overwritten).`,
    a.dependencies.added.length
      ? `- Dependencies added (exact versions, existing ones unchanged): ${a.dependencies.added.map((d) => `\`${d}\``).join(", ")}.`
      : "- No new dependencies.",
    a.settings.length
      ? `- Settings documented by name (no values): ${a.settings.map((s) => `\`${s}\``).join(", ")}.`
      : "- No new settings.",
    a.migration.kind === "drizzle-kit"
      ? `- Database: tables registered in your Drizzle schema; migration generated with your drizzle-kit config${a.migration.dir ? ` in \`${a.migration.dir}/\`` : ""}.`
      : a.migration.kind === "sql"
        ? `- Database: SQL migration in \`${a.migration.dir}/\`.`
        : "- No database changes.",
    "",
    `## Your project, as analysed`,
    "",
    ...r.conventions.map((c) => `- ${c}`),
    "",
    `## Decisions and why`,
    "",
    "| Topic | Decision | Why |",
    "|---|---|---|",
    ...a.decisions.map((d) => `| ${esc(d.topic)} | ${esc(d.choice)} | ${esc(d.why)} |`),
    ...input.glue.map(
      (g) =>
        `| glue | \`${g.path}\` ${g.by === "model" ? "written by the TurbineH adaptation model and verified" : "deterministic fallback"} | ${g.by === "model" ? "Connects the capability to code of yours that has no standard shape." : "The adaptation model was not available or its output did not pass the checks."} |`,
    ),
    "",
    ...(a.findings.conflicts.length
      ? [
          `## Differences found (and how they were handled)`,
          "",
          ...a.findings.conflicts.map((c) => `- ${c}`),
          "",
        ]
      : []),
    `## Files`,
    "",
    "| Change | Path | Why |",
    "|---|---|---|",
    ...modified.map((f) => `| modified | \`${f.path}\` | ${esc(f.why)} |`),
    ...[...groups.entries()].map(
      ([p, n]) =>
        `| added | \`${p}${n > 1 || !/\.\w+$/.test(p) ? "/" : ""}\`${n > 1 ? ` (${n} files)` : ""} | ${esc(added.find((f) => f.path === p || f.path.startsWith(`${p}/`))?.why ?? "")} |`,
    ),
    "",
    `## Commits (one per logical step)`,
    "",
    ...input.commits.map((c) => `- \`${c.sha.slice(0, 8)}\` ${c.message}`),
    "",
    `## Verification in your project`,
    "",
  ];
  if (v.state === "running") lines.push("_Running…_", "");
  else {
    lines.push(
      "Run on this branch in an ephemeral sandbox: no secrets, network only for the package registry while installing (install scripts disabled), then no network for the checks.",
      "",
      "| Check | Result | Detail |",
      "|---|---|---|",
      ...v.checks.map((c) => `| ${esc(c.name)} | ${mark(c.ok)} | ${esc(c.detail).slice(0, 300)} |`),
      "",
    );
    const failed = v.checks.filter((c) => c.ok === false);
    if (failed.length)
      lines.push(
        "### What failed and what to do",
        "",
        ...failed.map(
          (c) => `- **${c.name}**: ${esc(c.detail)}${c.action ? ` → ${c.action}` : ""}`,
        ),
        "",
      );
  }
  lines.push(
    `### Limits`,
    "",
    ...(a.limits.length ? a.limits.map((l) => `- ${l}`) : []),
    "- Checks ran with placeholder settings and a throwaway database: real credentials and third-party services are not exercised.",
    "",
    `## What you must configure`,
    "",
    ...a.reviewerSetup.map((s, i) => `${i + 1}. ${s}`),
    "",
    `## What is left in the capability itself`,
    "",
    ...(a.packageLeft === null
      ? [
          "Component package: no open criteria. Usage and examples are in the capability's `agent/INTEGRATE.md`.",
        ]
      : a.packageLeft.length
        ? [
            "From the package's agent guide (AGENTS.md / turbineh.json), with paths in your project:",
            "",
            ...a.packageLeft.map(
              (l) =>
                `- **[${esc(l.kind)}]** ${esc(l.what)} — where: \`${esc(l.where)}\` — how: ${esc(l.how)}`,
            ),
          ]
        : ["Nothing: every acceptance criterion of the package is met and proven by a test."]),
    "",
    `## How to revert`,
    "",
    "- Before merging: close this pull request and delete the branch — nothing else changed.",
    `- After merging: \`git revert -m 1 <merge commit>\` (or revert the commits listed above). Everything lives in \`${a.namespace}/\` plus the modified files in the table.`,
    "",
    "---",
    `Opened by TurbineH for plan \`${input.planId.slice(0, 8)}\`${input.flowUrl ? ` · [flow](${input.flowUrl})` : ""}. Nothing is merged automatically.`,
  );
  return lines.join("\n");
}

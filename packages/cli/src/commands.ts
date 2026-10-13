import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readZip } from "@turbineh/engine";
import type { CapabilitySummary, FlowResult, Plan } from "@turbineh/shared";
import { api, sleep } from "./api.js";
import {
  baseUrl,
  ensureProject,
  fail,
  readProject,
  writeProject,
  writeUserConfig,
  readUserConfig,
  type IntegrationEntry,
} from "./context.js";
import { bold, dim, green, red, STATE_LABEL, yellow, type CommandResult } from "./output.js";
import {
  AGENT_BLOCK,
  appendEnvExample,
  extractPackage,
  git,
  isClean,
  isGitRepo,
  localManifests,
  localStack,
  mergeDependencies,
  missingEnv,
} from "./project.js";
import { left as leftOf, readGuide, verifyPackage } from "./package-guide.js";

export interface Ctx {
  cwd: string;
  args: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
  confirm: (question: string) => Promise<boolean>;
}

interface PlanResponse {
  id: string;
  need: string;
  state: string;
  plan: Plan | null;
  result: FlowResult;
}

const workspaceOf = (cwd: string) => readProject(cwd)?.workspace;

// ── login / init ──────────────────────────────────────────────────────────────────────────────────────────

export async function login(c: Ctx): Promise<CommandResult> {
  const t = c.args[0] ?? process.env.TURBINEH_TOKEN;
  if (!t)
    fail(
      "usage",
      "No token given.",
      "Run `turbineh login <token>` with the token from your invitation.",
    );
  const url = typeof c.flags.url === "string" ? c.flags.url : readUserConfig().url;
  const path = writeUserConfig({ token: t as string, ...(url ? { url } : {}) });
  await api("/v1/capabilities?q=&limit=1");
  return {
    ok: true,
    command: "login",
    data: { configured: path, url: baseUrl() },
    lines: [
      `${green("✔")} Token saved in ${path} (only readable by you) and accepted by ${baseUrl()}.`,
    ],
    next: "turbineh init   (in your project folder)",
  };
}

export async function init(c: Ctx): Promise<CommandResult> {
  const existing = readProject(c.cwd);
  const project = ensureProject(c.cwd);
  const stack = localStack(c.cwd);
  project.preferences = { ...project.preferences, stack };
  writeProject(c.cwd, project);
  const target = existsSync(join(c.cwd, "CLAUDE.md"))
    ? "CLAUDE.md"
    : existsSync(join(c.cwd, "AGENTS.md"))
      ? "AGENTS.md"
      : "CLAUDE.md";
  let wrote = false;
  const already =
    existsSync(join(c.cwd, target)) &&
    readFileSync(join(c.cwd, target), "utf8").includes("## TurbineH capabilities");
  if (!already && c.flags.yes) {
    appendFileSync(
      join(c.cwd, target),
      `${existsSync(join(c.cwd, target)) ? "\n" : ""}${AGENT_BLOCK}`,
    );
    wrote = true;
  }
  return {
    ok: true,
    command: "init",
    data: {
      project: ".turbineh/project.json",
      workspace: project.workspace,
      stack,
      agentInstructions: { file: target, written: wrote || already, block: AGENT_BLOCK },
    },
    lines: [
      `${green("✔")} ${existing ? "Updated" : "Created"} .turbineh/project.json (workspace ${project.workspace.slice(0, 8)}…)`,
      `  Stack: ${stack.language}${stack.framework ? ` · ${stack.framework}` : ""}${stack.versions.next ? ` ${stack.versions.next}` : ""}${stack.packageManager ? ` · ${stack.packageManager}` : ""}`,
      `  Change policy: apply ${project.preferences.changePolicy?.autoApply === "never" ? "only after you confirm" : "automatically"} · new dependencies ${project.preferences.changePolicy?.allowDependencyChanges ? "allowed" : "not allowed"}`,
      "",
      wrote || already
        ? `${green("✔")} Agent instructions ${already ? "already in" : "added to"} ${target}.`
        : `Proposed block for ${target} (run \`turbineh init --yes\` to add it):\n\n${dim(AGENT_BLOCK)}`,
    ],
    next: 'turbineh search "<what you need>"',
  };
}

// ── search / inspect ──────────────────────────────────────────────────────────────────────────────────────

export async function search(c: Ctx): Promise<CommandResult> {
  const q = c.args.join(" ").trim();
  if (!q)
    fail(
      "usage",
      "Describe what you need.",
      'Run `turbineh search "support agent with a knowledge base"`.',
    );
  const r = await api<{
    results: (CapabilitySummary & { score: number })[];
    total: { components: number };
  }>(`/v1/capabilities?q=${encodeURIComponent(q)}&limit=${Number(c.flags.limit) || 10}`, {
    workspace: workspaceOf(c.cwd),
  });
  return {
    ok: true,
    command: "search",
    data: r,
    lines: r.results.length
      ? [
          bold(
            `${r.results.length} matches for "${q}" (${r.total.components} verified components in the repository)`,
          ),
          "",
          ...r.results.flatMap((x) => [
            `${x.kind === "use_case" ? green("◆ flow") : "◇ component"}  ${bold(x.id)}  ${dim(x.kind === "use_case" ? `${x.components} components` : "")}`,
            `   ${x.summary}`,
            ...(x.requirements.length
              ? [`   ${dim(`needs: ${x.requirements.map((q2) => q2.name).join(", ")}`)}`]
              : []),
          ]),
        ]
      : [`No verified capability matches "${q}" yet.`],
    next: r.results[0]
      ? `turbineh inspect ${r.results[0].id}   or   turbineh plan "${q}"`
      : "Describe the need differently.",
  };
}

export async function inspect(c: Ctx): Promise<CommandResult> {
  const id = c.args[0];
  if (!id)
    fail(
      "usage",
      "Which capability?",
      "Run `turbineh inspect <id>` (ids come from `turbineh search`).",
    );
  const r = await api<{
    capability: CapabilitySummary;
    components?: { id: string; version: string; license: string; does: string }[];
    doesNot?: string;
  }>(`/v1/capabilities/${encodeURIComponent(id as string)}`, { workspace: workspaceOf(c.cwd) });
  return {
    ok: true,
    command: "inspect",
    data: r,
    lines: [
      bold(
        `${r.capability.name} (${r.capability.kind === "use_case" ? "complete flow" : "component"})`,
      ),
      r.capability.summary,
      ...(r.doesNot ? [dim(`Does not: ${r.doesNot}`)] : []),
      "",
      `Stack: ${r.capability.stacks.join(", ")}`,
      `Example: ${r.capability.example}`,
      ...(r.capability.requirements.length
        ? ["Needs:", ...r.capability.requirements.map((q) => `  - ${q.name}: ${q.why}`)]
        : []),
      ...(r.components?.length
        ? [
            "",
            `Verified components (${r.components.length}):`,
            ...r.components.slice(0, 25).map((x) => `  - ${x.id}@${x.version} (${x.license})`),
          ]
        : []),
    ],
    next: `turbineh plan "<your need>"`,
  };
}

// ── plan ──────────────────────────────────────────────────────────────────────────────────────────────────

async function waitFor(
  id: string,
  ws: string | undefined,
  until: (s: string) => boolean,
  json: boolean,
  max = 30 * 60_000,
): Promise<PlanResponse> {
  const started = Date.now();
  let last = "";
  for (;;) {
    const r = await api<PlanResponse>(`/v1/plans/${id}`, { workspace: ws });
    if (!json && r.state !== last) {
      process.stderr.write(`${dim(`… ${STATE_LABEL[r.state] ?? r.state}`)}\n`);
      last = r.state;
    }
    if (until(r.state) || r.state === "failed") return r;
    if (Date.now() - started > max)
      fail(
        "timeout",
        "Still running after the waiting time.",
        "Check again later.",
        `turbineh status ${id}`,
      );
    await sleep(Number(process.env.TURBINEH_POLL_MS ?? 3000));
  }
}

export function planLines(p: Plan): string[] {
  return [
    bold(
      `Plan ${p.id.slice(0, 8)} · ${p.capability.name} (${p.capability.kind === "use_case" ? "complete flow" : "components"})`,
    ),
    `Need: ${p.need}`,
    `Your stack: ${p.stack.language}${p.stack.framework ? ` · ${p.stack.framework}` : ""}${
      Object.keys(p.stack.versions).length
        ? ` (${Object.entries(p.stack.versions)
            .slice(0, 4)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")})`
        : ""
    } · ${p.compatible ? green("compatible") : red("needs adaptation")}`,
    ...p.incompatibilities.map((i) => `  ${red("✖")} ${i}`),
    ...p.missing.map((m) => `  ${yellow("!")} ${m}`),
    "",
    bold(`Components (${p.components.length} verified):`),
    ...p.components.map((x) => `  - ${x.id}@${x.version} (${x.license}) — ${x.why}`),
    "",
    bold("Changes in your project:"),
    ...p.files.map((f) => `  ${f.action === "add" ? "+" : "~"} ${f.path}  ${dim(f.why)}`),
    ...(p.dependencies.length
      ? [
          `  Dependencies: ${p.dependencies
            .slice(0, 12)
            .map((d) => `${d.name}@${d.version}`)
            .join(", ")}${p.dependencies.length > 12 ? ` (+${p.dependencies.length - 12})` : ""}`,
        ]
      : []),
    ...(p.config.length
      ? [`  Settings you provide: ${p.config.map((q) => q.name).join(", ")}`]
      : []),
    "",
    `Estimate: ~${p.estimate.seconds}s · ${p.estimate.tokens.toLocaleString("en")} tokens · ~${p.estimate.newLinesToMaintain} new lines to maintain`,
    ...(p.needsApproval.length
      ? [
          "",
          yellow(bold("Needs your decision:")),
          ...p.needsApproval.map((n) => `  ${yellow("?")} ${n}`),
        ]
      : []),
  ];
}

export async function plan(c: Ctx): Promise<CommandResult> {
  const need = c.args.join(" ").trim();
  if (!need)
    fail(
      "usage",
      "Describe what you need.",
      'Run `turbineh plan "AI booking agent for a physio clinic"`.',
    );
  const project = ensureProject(c.cwd);
  writeProject(c.cwd, project);
  const files = localManifests(c.cwd);
  const created = await api<{ id: string; stack: Plan["stack"] }>("/v1/plans", {
    method: "POST",
    workspace: project.workspace,
    body: {
      need,
      environment: Object.keys(files).length
        ? { files }
        : typeof c.flags.stack === "string"
          ? { stack: { language: "typescript", framework: c.flags.stack } }
          : {},
      preferences: project.preferences,
    },
  });
  project.lastPlan = created.id;
  writeProject(c.cwd, project);
  if (c.flags.wait === false) {
    return {
      ok: true,
      command: "plan",
      state: "planning",
      data: created,
      next: `turbineh status ${created.id}`,
    };
  }
  const r = await waitFor(created.id, project.workspace, (s) => s === "planned", c.json);
  if (r.state === "failed" || !r.plan) {
    return {
      ok: false,
      command: "plan",
      state: r.state,
      data: r,
      ...(r.result.errors[0] ? { error: r.result.errors[0] } : {}),
    };
  }
  return {
    ok: true,
    command: "plan",
    state: r.state,
    data: r.plan,
    lines: planLines(r.plan),
    next: r.plan.needsApproval.length
      ? `turbineh apply ${r.id} --approve   (after reviewing the decisions above)`
      : `turbineh apply ${r.id}`,
  };
}

// ── apply ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function apply(c: Ctx): Promise<CommandResult> {
  const project = ensureProject(c.cwd);
  const id =
    c.args[0] ??
    (typeof c.flags.resume === "string" ? c.flags.resume : undefined) ??
    project.lastPlan;
  if (!id) fail("usage", "No plan to apply.", 'Run `turbineh plan "<need>"` first.');
  const ws = project.workspace;
  let r = await api<PlanResponse>(`/v1/plans/${id}`, { workspace: ws });
  if (r.state === "planned") {
    await api(`/v1/plans/${id}/generate`, {
      method: "POST",
      workspace: ws,
      body: { approve: c.flags.approve === true },
    });
    r = await waitFor(id as string, ws, (s) => ["verified", "generated"].includes(s), c.json);
  } else if (r.state === "planning" || r.state === "generating") {
    r = await waitFor(
      id as string,
      ws,
      (s) => ["verified", "generated", "planned"].includes(s),
      c.json,
    );
    if (r.state === "planned") return apply(c);
  }
  if (r.state === "failed")
    return {
      ok: false,
      command: "apply",
      state: r.state,
      data: r.result,
      ...(r.result.errors[0] ? { error: r.result.errors[0] } : {}),
    };
  if (!["verified", "generated", "integrated", "integration_verified"].includes(r.state))
    fail(
      "not_ready",
      `The flow is ${r.state}.`,
      "Wait until the package is verified.",
      `turbineh apply ${id}`,
    );

  if (!isGitRepo(c.cwd))
    fail(
      "no_git",
      "This folder is not a git repository.",
      "Run `git init && git add -A && git commit -m init` so the integration can be reviewed and reverted.",
      `turbineh apply ${id}`,
    );
  if (!isClean(c.cwd))
    fail(
      "dirty_tree",
      "You have uncommitted changes.",
      "Commit or stash them: the integration goes in its own commit so it can be reverted cleanly.",
      `turbineh apply ${id}`,
    );

  const zip = await api<Buffer>(`/v1/plans/${id}/package`, { workspace: ws, raw: true });
  const manifestText = readZip(zip).find(
    (e) => e.path.endsWith("/manifest.json") && e.path.split("/").length === 2,
  );
  const manifest = manifestText
    ? (JSON.parse(manifestText.data.toString("utf8")) as {
        slug: string;
        dependencies: Record<string, string>;
        environment: string[];
        state: string;
      })
    : null;
  if (!manifest)
    fail(
      "bad_package",
      "The package has no manifest.",
      "Generate it again.",
      `turbineh apply ${id}`,
    );
  const m = manifest as NonNullable<typeof manifest>;
  const policy = project.preferences.changePolicy;
  const plan = r.plan;
  const summary = [
    bold(`Integration of ${m.slug} (${STATE_LABEL[r.state] ?? r.state})`),
    `  + turbineh/${m.slug}/  (code, tests, example, docs, agent/INTEGRATE.md)`,
    `  ~ package.json  ${Object.keys(m.dependencies).length} dependencies checked (only missing ones are added)`,
    `  ~ .env.example  ${m.environment.length} settings documented (names only)`,
    ...(plan?.needsApproval.length
      ? [yellow(`  ${plan.needsApproval.length} decision(s) were approved for this plan`)]
      : []),
  ];
  const auto = c.flags.yes === true || policy?.autoApply === "always";
  if (!auto && !c.json) {
    for (const l of summary) process.stdout.write(`${l}\n`);
    if (!(await c.confirm("Apply these changes on a new branch? [y/N] ")))
      return {
        ok: false,
        command: "apply",
        state: r.state,
        error: {
          code: "cancelled",
          message: "Nothing was changed.",
          action: "Run the same command when you are ready.",
          resume: `turbineh apply ${id}`,
        },
      };
  } else if (!auto && c.json) {
    fail(
      "needs_confirmation",
      "Applying changes needs confirmation.",
      "Show the plan to the user and re-run with --yes once they agree.",
      `turbineh apply ${id} --yes --json`,
    );
  }

  const branch = `turbineh/${m.slug}-${String(id).slice(0, 8)}`;
  git(c.cwd, "checkout", "-q", "-b", branch);
  extractPackage(c.cwd, zip, m.slug);
  const deps =
    policy?.allowDependencyChanges === false
      ? { added: [], kept: Object.keys(m.dependencies) }
      : mergeDependencies(c.cwd, m.dependencies);
  const env = policy?.allowNewEnv === false ? [] : appendEnvExample(c.cwd, m.environment, m.slug);
  git(c.cwd, "add", "-A", "--", ".", ":(exclude).turbineh");
  git(
    c.cwd,
    "-c",
    "user.name=TurbineH",
    "-c",
    "user.email=noreply@turbineh.com",
    "commit",
    "-q",
    "-m",
    `feat(turbineh): integrate ${m.slug} (plan ${String(id).slice(0, 8)})`,
  );
  const commit = git(c.cwd, "rev-parse", "HEAD");
  const integrationId = `in_${randomBytes(9).toString("base64url")}`;
  const entry: IntegrationEntry = {
    id: integrationId,
    planId: id as string,
    slug: m.slug,
    branch,
    commit,
    state: "integrated",
    at: new Date().toISOString(),
  };
  project.integrations.push(entry);
  writeProject(c.cwd, project);
  await api(`/v1/plans/${id}/integrations`, {
    method: "POST",
    workspace: ws,
    body: { state: "integrated", integration_id: integrationId, where: "local", branch, commit },
  }).catch(() => undefined);
  const missing = missingEnv(c.cwd, m.environment);
  return {
    ok: true,
    command: "apply",
    state: "integrated",
    data: {
      integration: entry,
      dependenciesAdded: deps.added,
      dependenciesAlreadyPresent: deps.kept,
      envDocumented: env,
      missingSettings: missing,
      agentInstructions: r.result.agentInstructions,
    },
    lines: [
      ...summary,
      "",
      `${green("✔")} Committed ${commit.slice(0, 8)} on branch ${branch} (integration ${integrationId}).`,
      ...(deps.added.length
        ? [`  Added dependencies: ${deps.added.join(", ")} — run your package manager's install.`]
        : []),
      ...(missing.length
        ? [yellow(`  Missing settings (set them in .env.local): ${missing.join(", ")}`)]
        : []),
      "",
      `For your coding agent: "${r.result.agentInstructions}"`,
    ],
    next: `Wire it in following turbineh/${m.slug}/agent/INTEGRATE.md, then: turbineh verify`,
  };
}

// ── verify / revert / status ──────────────────────────────────────────────────────────────────────────────

/** The line that explains a failure: the first error line, else the last line that is not the script banner. */
function headline(detail: string): string {
  const lines = detail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(">"));
  return lines.find((l) => /\berror\b/i.test(l)) ?? lines.at(-1) ?? detail.split("\n")[0] ?? "";
}

function run(cwd: string, cmd: string, args: string[]): { ok: boolean; detail: string } {
  try {
    execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
    return { ok: true, detail: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      detail: `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`.trim().slice(-1500),
    };
  }
}

export async function verify(c: Ctx): Promise<CommandResult> {
  const project = readProject(c.cwd);
  // A delivered TurbineH package (turbineh.json) without capability integrations: check the package itself.
  const guide = readGuide(c.cwd);
  if (guide && !c.args[0] && !project?.integrations.some((i) => i.state !== "reverted")) {
    return verifyPackage(c.cwd, guide);
  }
  const entry = c.args[0]
    ? project?.integrations.find((i) => i.id === c.args[0] || i.slug === c.args[0])
    : project?.integrations.filter((i) => i.state !== "reverted").at(-1);
  if (!project || !entry)
    fail(
      "no_integration",
      "No integration to verify in this project.",
      "Run `turbineh apply` first.",
    );
  const e = entry as IntegrationEntry;
  const dir = join(c.cwd, "turbineh", e.slug);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    dependencies: Record<string, string>;
    environment: string[];
  };
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const pkgPath = join(c.cwd, "package.json");
  const pkg = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      })
    : {};
  const have = { ...pkg.dependencies, ...pkg.devDependencies };
  const notDeclared = Object.keys(manifest.dependencies).filter((d) => !(d in have));
  checks.push({
    name: "dependencies_declared",
    ok: notDeclared.length === 0,
    ...(notDeclared.length ? { detail: `Not in package.json: ${notDeclared.join(", ")}` } : {}),
  });
  const notInstalled = Object.keys(manifest.dependencies).filter(
    (d) => d in have && !existsSync(join(c.cwd, "node_modules", d)),
  );
  checks.push({
    name: "dependencies_installed",
    ok: notInstalled.length === 0,
    ...(notInstalled.length
      ? {
          detail: `Run your package manager's install (missing: ${notInstalled.slice(0, 8).join(", ")})`,
        }
      : {}),
  });
  const missing = missingEnv(c.cwd, manifest.environment);
  checks.push({
    name: "settings",
    ok: missing.length === 0,
    ...(missing.length ? { detail: `Set in .env.local: ${missing.join(", ")}` } : {}),
  });
  const pm = existsSync(join(c.cwd, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(c.cwd, "yarn.lock"))
      ? "yarn"
      : "npm";
  for (const script of ["typecheck", "lint", "test"]) {
    if (pkg.scripts?.[script] && c.flags["skip-scripts"] !== true) {
      const r = run(c.cwd, pm, ["run", script]);
      checks.push({ name: script, ok: r.ok, ...(r.detail ? { detail: r.detail } : {}) });
    }
  }
  const ok = checks.every((x) => x.ok);
  const state = ok ? "integration_verified" : "integrated";
  if (ok) {
    e.state = "integration_verified";
    writeProject(c.cwd, project as NonNullable<typeof project>);
  }
  await api(`/v1/plans/${e.planId}/integrations`, {
    method: "POST",
    workspace: project?.workspace,
    body: {
      state: ok ? "integration_verified" : "integrated",
      integration_id: e.id,
      where: "local",
      branch: e.branch,
      commit: e.commit,
      checks: checks.map((x) => ({
        name: x.name,
        ok: x.ok,
        ...(x.detail ? { detail: x.detail.slice(0, 500) } : {}),
      })),
    },
  }).catch(() => undefined);
  const first = checks.find((x) => !x.ok);
  return {
    ok,
    command: "verify",
    state,
    data: {
      integration: e.id,
      checks,
      limits:
        "Checks run your project's own scripts plus dependency and settings checks; wiring of routes/UI is reviewed by you or your agent (agent/INTEGRATE.md).",
    },
    lines: [
      bold(`Verification of ${e.slug} in this project`),
      ...checks.map(
        (x) =>
          `  ${x.ok ? green("✔") : red("✖")} ${x.name}${x.detail ? dim(` — ${headline(x.detail)}`) : ""}`,
      ),
    ],
    ...(first
      ? {
          error: {
            code: first.name === "settings" ? "missing_env" : `check_failed_${first.name}`,
            message:
              first.name === "settings"
                ? `Settings missing: ${missing.join(", ")}.`
                : `${first.name} failed.`,
            action: first.detail ? headline(first.detail) : "Fix it and verify again.",
            resume: `turbineh verify ${e.id}`,
          },
        }
      : { next: "Keep building — the capability is integrated and verified here." }),
  };
}

/** What is left in a delivered package (turbineh.json): open criteria, gaps, gate findings, missing settings. */
export async function left(c: Ctx): Promise<CommandResult> {
  const guide = readGuide(c.cwd);
  if (!guide)
    fail(
      "no_package",
      "No turbineh.json here: this is not a TurbineH package.",
      "Run it in the root of a repository delivered by TurbineH.",
    );
  return leftOf(c.cwd, guide as NonNullable<typeof guide>);
}

export async function revert(c: Ctx): Promise<CommandResult> {
  const project = readProject(c.cwd);
  const id = c.args[0];
  const entry = id
    ? project?.integrations.find((i) => i.id === id || i.slug === id)
    : project?.integrations.filter((i) => i.state !== "reverted").at(-1);
  if (!project || !entry)
    fail("no_integration", "No such integration.", "List them with `turbineh status`.");
  const e = entry as IntegrationEntry;
  if (!isClean(c.cwd))
    fail(
      "dirty_tree",
      "You have uncommitted changes.",
      "Commit or stash them first.",
      `turbineh revert ${e.id}`,
    );
  git(
    c.cwd,
    "-c",
    "user.name=TurbineH",
    "-c",
    "user.email=noreply@turbineh.com",
    "revert",
    "--no-edit",
    e.commit,
  );
  const commit = git(c.cwd, "rev-parse", "HEAD");
  e.state = "reverted";
  writeProject(c.cwd, project as NonNullable<typeof project>);
  await api(`/v1/plans/${e.planId}/integrations`, {
    method: "POST",
    workspace: project?.workspace,
    body: { state: "reverted", integration_id: e.id, where: "local", commit },
  }).catch(() => undefined);
  return {
    ok: true,
    command: "revert",
    data: { integration: e.id, revertCommit: commit },
    lines: [
      `${green("✔")} Reverted ${e.slug}: commit ${commit.slice(0, 8)} undoes ${e.commit.slice(0, 8)} only; later work is kept.`,
    ],
    next: "Done. `turbineh plan` to try something else.",
  };
}

export async function status(c: Ctx): Promise<CommandResult> {
  const project = readProject(c.cwd);
  const id = c.args[0];
  if (id) {
    const r = await api<PlanResponse>(`/v1/plans/${id}`, { workspace: project?.workspace });
    return {
      ok: r.state !== "failed",
      command: "status",
      state: r.state,
      data: r,
      lines: [
        bold(`${r.need}`),
        ...(r.result.works.length
          ? ["Works:", ...r.result.works.map((w) => `  ${green("✔")} ${w}`)]
          : []),
        ...(r.result.needs.length
          ? ["Needs:", ...r.result.needs.map((n) => `  ${yellow("!")} ${n.name} — ${n.why}`)]
          : []),
      ],
      ...(r.result.errors[0] ? { error: r.result.errors[0] } : {}),
    };
  }
  const a = await api<{
    totals: Record<string, number>;
    flows: { id: string; need: string; state: string }[];
  }>("/v1/activity?limit=10", { workspace: project?.workspace });
  return {
    ok: true,
    command: "status",
    data: { activity: a, integrations: project?.integrations ?? [] },
    lines: [
      bold(`Workspace ${project?.workspace.slice(0, 8) ?? "(no project — run turbineh init)"}`),
      ...a.flows.map(
        (f) =>
          `  ${f.id.slice(0, 8)}  ${(STATE_LABEL[f.state] ?? f.state).padEnd(44)} ${f.need.slice(0, 60)}`,
      ),
      ...(project?.integrations.length
        ? [
            "Integrations here:",
            ...project.integrations.map(
              (i) => `  ${i.id}  ${i.slug}  ${i.state}  ${i.commit.slice(0, 8)}`,
            ),
          ]
        : []),
    ],
  };
}

export function writeAgentBlock(cwd: string): void {
  writeFileSync(join(cwd, ".turbineh", "AGENT_INSTRUCTIONS.md"), AGENT_BLOCK);
}

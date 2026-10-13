import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { isGapNotice, readZip } from "@turbineh/engine";
import type { FlowResult, Plan } from "@turbineh/shared";
import { adaptLocally } from "./adapt-local.js";
import { cliCommand } from "./agent-docs.js";
import { api, sleep } from "./api.js";
import type { Ctx } from "./commands.js";
import {
  CliError,
  ensureProject,
  fail,
  readProject,
  writeProject,
  type IntegrationEntry,
  type ProjectFile,
} from "./context.js";
import { bold, cyan, dim, green, red, yellow, type CommandResult } from "./output.js";
import { left as leftOf, missingSettings, readGuide } from "./package-guide.js";
import { git, isGitRepo, localManifests } from "./project.js";

/**
 * `turbineh build "<spec>" | @spec.md` (ADR-0036): one command from a specification to verified code committed in the
 * current folder — plan → generate → wait → write → commit → summary. An empty folder gets the complete application;
 * an existing project gets the capability adapted with the GitHub integration's rules. Progress stays to a few lines;
 * `--json` streams one event per line (`started`, `plan_ready`) and ends with the result line.
 */

/** Exit codes: what an agent or script can branch on without parsing text. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  /** A person has to decide (plan needs approval): re-run with --approve after reviewing. */
  decision: 3,
  /** Still running after --timeout: `turbineh resume <id>` continues where it stopped. */
  timeout: 4,
  /** TurbineH could not generate the package. */
  failed: 5,
  /** Written and committed, but the verification gate is not green: see `left`. */
  notGreen: 6,
  /** This folder cannot take the code as is (local changes in files it must modify, incompatible project). */
  conflict: 7,
} as const;

export const MAX_SPEC = 20_000;

/** The command as this machine runs it (full path when not on PATH), for the next steps printed. */
const bin = () => cliCommand();

interface PlanResponse {
  id: string;
  need: string;
  state: string;
  plan: Plan | null;
  result: FlowResult;
}

export type Target = "app" | "repo";

/** What makes a folder another kind of project (code TurbineH must not be dropped next to). */
const OTHER_PROJECT =
  /^(pyproject\.toml|requirements\.txt|setup\.py|Pipfile|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?|composer\.json|mix\.exs|deno\.json|.*\.(py|go|rs|java|kt|rb|php|cs|swift|ts|tsx|js|jsx|mjs|cjs)|src|app|lib|pages)$/i;

/**
 * repo = a JavaScript/TypeScript project (package.json); app = a folder without code (empty, or docs, the spec, agent
 * settings, logs): the complete application goes there; null = another kind of project.
 */
export function targetOf(cwd: string): Target | null {
  if (existsSync(join(cwd, "package.json"))) return "repo";
  return readdirSync(cwd).some((e) => OTHER_PROJECT.test(e)) ? null : "app";
}

/** The specification: the arguments, `@file` / `--spec file`, or `-` for stdin. */
export async function readSpec(c: Ctx): Promise<string> {
  const raw = c.args.join(" ").trim();
  const file =
    typeof c.flags.spec === "string" ? c.flags.spec : raw.startsWith("@") ? raw.slice(1) : null;
  let text = raw;
  if (file) {
    const p = isAbsolute(file) ? file : resolve(c.cwd, file);
    if (!existsSync(p))
      fail("usage", `Specification file not found: ${file}.`, "Check the path after @.");
    text = readFileSync(p, "utf8");
  } else if (raw === "-") {
    const chunks: Buffer[] = [];
    for await (const ch of process.stdin) chunks.push(ch as Buffer);
    text = Buffer.concat(chunks).toString("utf8");
  }
  text = text.replace(/\r\n/g, "\n").trim();
  if (text.length < 8)
    fail(
      "usage",
      "Describe what to build.",
      'Run `turbineh build "online shop with Stripe checkout and an admin area"` or `turbineh build @spec.md`.',
    );
  if (text.length > MAX_SPEC)
    fail(
      "usage",
      `The specification has ${text.length} characters (limit ${MAX_SPEC}).`,
      "Keep the parts that state behaviour, data and constraints; drop background and examples.",
    );
  return text;
}

const exitOf = (code: string): number =>
  code === "usage" ? EXIT.usage : code === "needs_approval" ? EXIT.decision : EXIT.error;

export async function build(c: Ctx): Promise<CommandResult> {
  if (typeof c.flags.resume === "string") return resume({ ...c, args: [c.flags.resume] });
  const need = await readSpec(c);
  const target = targetOf(c.cwd);
  if (!target)
    fail(
      "not_a_project",
      "This folder holds code of another kind of project (no package.json): TurbineH does not mix its app into it.",
      "Run it in an empty folder (complete application) or in the root of a JavaScript/TypeScript project.",
    );
  try {
    git(c.cwd, "--version");
  } catch {
    fail(
      "no_git",
      "git is not installed.",
      "Install git: the code arrives as one revertable commit.",
    );
  }
  const project = ensureProject(c.cwd);
  const files = target === "repo" ? localManifests(c.cwd) : {};
  const created = await api<{ id: string }>("/v1/plans?wait=0", {
    method: "POST",
    workspace: project.workspace,
    body: {
      need,
      environment: Object.keys(files).length ? { files } : {},
      preferences: project.preferences,
      generate: true,
    },
  }).catch((err: unknown) => {
    if (err instanceof CliError) throw new CliError(err.error, exitOf(err.error.code));
    throw err;
  });
  project.lastPlan = created.id;
  project.pending = {
    id: created.id,
    target: target as Target,
    need: need.slice(0, 200),
    startedAt: new Date().toISOString(),
  };
  writeProject(c.cwd, project);
  c.emit?.({ event: "started", id: created.id, target, resume: `${bin()} resume ${created.id}` });
  return follow(c, created.id, target as Target, Date.now());
}

/** `turbineh resume [id]`: keep waiting for a build (after a timeout or an interruption) and write it here. */
export async function resume(c: Ctx): Promise<CommandResult> {
  const project = readProject(c.cwd);
  const id = c.args[0] ?? project?.pending?.id;
  if (!id)
    fail(
      "usage",
      "Nothing to resume here.",
      'Start one with `turbineh build "<spec>"` (or pass the id: `turbineh resume <id>`).',
    );
  const target =
    project?.pending && project.pending.id === id
      ? project.pending.target
      : (targetOf(c.cwd) ?? "repo");
  if (project && project.pending?.id !== id) {
    project.pending = { id: id as string, target, need: "", startedAt: new Date().toISOString() };
    writeProject(c.cwd, project);
  }
  return follow(c, id as string, target, Date.now());
}

/** Waits from 1 s (first half minute) to 2 s between checks: no fixed 10-second polls. */
const pollMs = (elapsed: number) =>
  Number(process.env.TURBINEH_POLL_MS ?? (elapsed < 30_000 ? 1000 : 2000));

/** The first event an agent can act on: what will be built and which criteria nothing will prove yet. */
export function planReady(id: string, p: Plan): Record<string, unknown> {
  const criteria = p.criteria ?? [];
  return {
    event: "plan_ready",
    id,
    capability: { id: p.capability.id, name: p.capability.name, kind: p.capability.kind },
    components: p.components.map((x) => `${x.id}@${x.version}`),
    criteria: {
      covered: criteria.filter((x) => x.status === "covered").map((x) => x.criterion),
      open: criteria.filter((x) => x.status === "open").map((x) => x.criterion),
    },
    settings: p.config.filter((x) => x.kind === "env").map((x) => x.name),
    estimateSeconds: p.estimate.seconds,
    note: "Criteria under `open` have no shipped test yet: plan them while the package builds (generated entity tests may still cover some; the final summary is authoritative).",
  };
}

async function follow(c: Ctx, id: string, target: Target, t0: number): Promise<CommandResult> {
  const project = ensureProject(c.cwd);
  const ws = project.workspace;
  const minutes = Number(c.flags.timeout ?? 20);
  const deadline = t0 + (Number.isFinite(minutes) && minutes > 0 ? minutes : 20) * 60_000;
  const say = (line: string) => {
    if (!c.json) process.stderr.write(`${dim(`… ${line}`)}\n`);
  };
  let planShown = false;
  let plannedSeen = 0;
  let generatingSaid = false;
  say(`planning (build ${id.slice(0, 8)})`);
  let r: PlanResponse;
  for (;;) {
    r = await api<PlanResponse>(`/v1/plans/${id}`, { workspace: ws });
    if (r.plan && !planShown) {
      planShown = true;
      const ev = planReady(id, r.plan);
      c.emit?.(ev);
      const cr = ev.criteria as { covered: string[]; open: string[] };
      say(
        `plan ready: ${r.plan.capability.name}, ${r.plan.components.length} verified components, ${cr.covered.length}/${cr.covered.length + cr.open.length} criteria proved by shipped tests`,
      );
    }
    if (r.state === "failed") {
      clearPending(c.cwd, id);
      const e = r.result.errors[0];
      return {
        ok: false,
        command: "build",
        state: "failed",
        exitCode: EXIT.failed,
        data: { id, result: r.result },
        error: e ?? {
          code: "generation_failed",
          message: "TurbineH could not generate this package.",
          action:
            "Rephrase the specification (one app, its data, roles and flows) and run build again.",
        },
      };
    }
    if (r.state === "planned") {
      const p = r.plan;
      const decisions = (p?.needsApproval ?? []).filter((d) => !isGapNotice(d));
      if (decisions.length && c.flags.approve !== true) {
        return {
          ok: false,
          command: "build",
          state: "planned",
          exitCode: EXIT.decision,
          data: { id, needsApproval: decisions, plan: p },
          lines: decisions.map((n) => `  ${yellow("?")} ${n}`),
          error: {
            code: "needs_approval",
            message: `The plan has ${decisions.length} decision(s) for a person.`,
            action: "Show them to the user; if they agree, continue with --approve.",
            resume: `${bin()} resume ${id} --approve`,
          },
        };
      }
      // The server continues by itself when nothing needs approval; ask explicitly if it has not after a moment.
      if (++plannedSeen >= 3 || c.flags.approve === true) {
        await api(`/v1/plans/${id}/generate`, {
          method: "POST",
          workspace: ws,
          // Asking for the build accepts that TurbineH writes the parts no component covers (same gate).
          body: { approve: c.flags.approve === true || decisions.length === 0 },
        }).catch((err: unknown) => {
          if (!(err instanceof CliError) || !/already|conflict/.test(err.error.code)) throw err;
        });
        plannedSeen = 0;
      }
    }
    if (r.state === "generating" && !generatingSaid) {
      generatingSaid = true;
      say(
        "generating and verifying in the TurbineH sandbox (lint, types, unit, build, E2E, security)",
      );
    }
    if (["verified", "generated", "integrated", "integration_verified"].includes(r.state)) break;
    if (Date.now() > deadline) {
      return {
        ok: false,
        command: "build",
        state: r.state,
        exitCode: EXIT.timeout,
        data: { id, state: r.state },
        error: {
          code: "timeout",
          message: `Still ${r.state} after ${minutes} minutes; nothing was written.`,
          action: "Continue waiting with the resume command (it writes the code when ready).",
          resume: `${bin()} resume ${id}`,
        },
      };
    }
    await sleep(pollMs(Date.now() - t0));
  }
  say("writing into this folder");
  const written =
    target === "app" ? await writeApp(c, id, r, project) : await writeRepo(c, id, r, project);
  clearPending(c.cwd, id);
  return summary(c, id, r, written, Date.now() - t0);
}

function clearPending(cwd: string, id: string): void {
  const p = readProject(cwd);
  if (p?.pending?.id === id) {
    delete p.pending;
    writeProject(cwd, p);
  }
}

// ── writing ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Written {
  target: Target;
  added: string[];
  modified: string[];
  /** Existing files kept as they were; the package's version was written next to them. */
  kept: { path: string; packageCopy: string }[];
  commit: string;
  branch: string;
  identity: "yours" | "fallback";
  /** Repo target: where the capability lives and what the adaptation left to do. */
  namespace?: string;
  adaptation?: {
    reviewerSetup: string[];
    limits: string[];
    settings: string[];
    dependenciesAdded: string[];
    left: { kind: string; what: string; where: string; how: string }[];
    packageManager: string;
  };
}

/** The user's git identity when set, otherwise TurbineH's (so the commit never fails for a missing identity). */
export function identity(cwd: string): { args: string[]; who: "yours" | "fallback" } {
  try {
    if (git(cwd, "config", "user.email") && git(cwd, "config", "user.name"))
      return { args: [], who: "yours" };
  } catch {
    // not set
  }
  return {
    args: ["-c", "user.name=TurbineH", "-c", "user.email=noreply@turbineh.com"],
    who: "fallback",
  };
}

const safePath = (p: string) => {
  const n = normalize(p).replace(/\\/g, "/");
  return !n.startsWith("..") && !isAbsolute(n) && !n.split("/").includes("..") ? n : null;
};

/** Package files and the folder's own: agent instructions are merged, .gitignore unioned, others never overwritten. */
export function writeAppFiles(
  cwd: string,
  entries: { path: string; data: Buffer }[],
): Pick<Written, "added" | "modified" | "kept"> {
  const added: string[] = [];
  const modified: string[] = [];
  const kept: Written["kept"] = [];
  const top = entries[0]?.path.split("/")[0] ?? "";
  for (const e of entries) {
    const rel = safePath(e.path.startsWith(`${top}/`) ? e.path.slice(top.length + 1) : e.path);
    if (!rel || rel.endsWith("/") || rel.startsWith(".git/")) continue;
    const dest = join(cwd, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest)) {
      writeFileSync(dest, e.data);
      added.push(rel);
      continue;
    }
    const mine = readFileSync(dest, "utf8");
    const theirs = e.data.toString("utf8");
    if (mine === theirs) continue;
    if (/^(CLAUDE|AGENTS)\.md$/i.test(rel)) {
      // The package's agent guide first (it describes this code), then what was already there.
      writeFileSync(dest, mine.includes(theirs.trim()) ? mine : `${theirs.trimEnd()}\n\n${mine}`);
      modified.push(rel);
    } else if (rel === ".gitignore") {
      const have = new Set(mine.split("\n").map((l) => l.trim()));
      const extra = theirs.split("\n").filter((l) => l.trim() && !have.has(l.trim()));
      writeFileSync(dest, `${mine.trimEnd()}\n${extra.join("\n")}\n`);
      modified.push(rel);
    } else {
      const copy = rel.replace(/(\.[^./]+)?$/, ".turbineh$1");
      writeFileSync(join(cwd, copy), e.data);
      kept.push({ path: rel, packageCopy: copy });
    }
  }
  return { added, modified, kept };
}

async function writeApp(
  c: Ctx,
  id: string,
  r: PlanResponse,
  project: ProjectFile,
): Promise<Written> {
  const zip = await api<Buffer>(`/v1/plans/${id}/package?format=app`, {
    workspace: project.workspace,
    raw: true,
  });
  const files = writeAppFiles(c.cwd, readZip(zip));
  // The project file holds local state (pending builds); it is not part of the code.
  const gi = join(c.cwd, ".gitignore");
  const giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/^\.turbineh\/project\.json$/m.test(giText))
    writeFileSync(gi, `${giText.trimEnd()}${giText ? "\n" : ""}.turbineh/project.json\n`);
  if (!isGitRepo(c.cwd)) git(c.cwd, "init", "-q", "-b", "main");
  const who = identity(c.cwd);
  git(c.cwd, "add", "-A");
  const name = readGuide(c.cwd)?.app.name ?? r.plan?.capability.name ?? "application";
  commit(c.cwd, who.args, `feat: ${name} — verified TurbineH package (build ${id.slice(0, 8)})`);
  return {
    target: "app",
    ...files,
    commit: git(c.cwd, "rev-parse", "HEAD"),
    branch: git(c.cwd, "rev-parse", "--abbrev-ref", "HEAD"),
    identity: who.who,
  };
}

function commit(cwd: string, idArgs: string[], message: string, paths?: string[]): void {
  try {
    git(cwd, ...idArgs, "commit", "-q", "-m", message, ...(paths ? ["--", ...paths] : []));
  } catch (err) {
    const e = err as { stderr?: Buffer };
    throw new CliError(
      {
        code: "commit_failed",
        message: `The files are written but git refused the commit: ${(e.stderr?.toString() ?? String(err)).trim().slice(0, 300)}`,
        action: "Fix what git reports (a hook, signing), then commit the TurbineH files yourself.",
      },
      EXIT.conflict,
    );
  }
}

const DEFAULT_BRANCH = /^(main|master|trunk|develop)$/;

async function writeRepo(
  c: Ctx,
  id: string,
  r: PlanResponse,
  project: ProjectFile,
): Promise<Written> {
  if (!isGitRepo(c.cwd)) {
    git(c.cwd, "init", "-q", "-b", "main");
  }
  const zip = await api<Buffer>(`/v1/plans/${id}/package`, {
    workspace: project.workspace,
    raw: true,
  });
  const { adaptation, files } = adaptLocally(c.cwd, zip, id, r.need);
  if (!adaptation.findings.compatible)
    throw new CliError(
      {
        code: "incompatible_project",
        message: `This project cannot host the capability as is: ${adaptation.findings.conflicts[0] ?? "incompatible stack"}.`,
        action:
          "Build it in an empty folder instead (complete application), or adapt the ZIP from `turbineh status` with your agent.",
      },
      EXIT.conflict,
    );
  // Files TurbineH must modify must not carry uncommitted changes: they would be mixed into its commit.
  const changedSinceHead = (() => {
    try {
      return git(c.cwd, "diff", "--name-only", "HEAD");
    } catch {
      return ""; // no commit yet: nothing of the user's is committed to protect
    }
  })();
  const dirty = new Set(changedSinceHead.split("\n").filter(Boolean));
  const clash = files.filter((f) => f.action === "modify" && dirty.has(f.path)).map((f) => f.path);
  if (clash.length)
    throw new CliError(
      {
        code: "dirty_files",
        message: `Uncommitted changes in files TurbineH has to modify: ${clash.join(", ")}.`,
        action: "Commit or stash those files, then run the resume command.",
        resume: `${bin()} resume ${id}`,
      },
      EXIT.conflict,
    );
  let branch = "HEAD";
  try {
    branch = git(c.cwd, "rev-parse", "--abbrev-ref", "HEAD");
  } catch {
    // no commits yet
  }
  // ADR-0031: never on the default branch of an existing project; a feature branch the agent works on is fine.
  const hasCommits = (() => {
    try {
      git(c.cwd, "rev-parse", "--verify", "-q", "HEAD");
      return true;
    } catch {
      return false;
    }
  })();
  if (hasCommits && DEFAULT_BRANCH.test(branch)) {
    branch = `turbineh/${adaptation.slug}-${id.slice(0, 8)}`;
    git(c.cwd, "checkout", "-q", "-b", branch);
  }
  for (const f of files) {
    const dest = join(c.cwd, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
  }
  const paths = files.map((f) => f.path);
  const who = identity(c.cwd);
  git(c.cwd, "add", "--", ...paths);
  commit(
    c.cwd,
    who.args,
    `feat(turbineh): integrate ${adaptation.slug} — verified TurbineH package (build ${id.slice(0, 8)})`,
    paths,
  );
  const commitSha = git(c.cwd, "rev-parse", "HEAD");
  const entry: IntegrationEntry = {
    id: `in_${randomBytes(9).toString("base64url")}`,
    planId: id,
    slug: adaptation.slug,
    branch,
    commit: commitSha,
    state: "integrated",
    at: new Date().toISOString(),
    dir: adaptation.namespace,
  };
  const p = ensureProject(c.cwd);
  p.integrations.push(entry);
  writeProject(c.cwd, p);
  await api(`/v1/plans/${id}/integrations`, {
    method: "POST",
    workspace: project.workspace,
    body: {
      state: "integrated",
      integration_id: entry.id,
      where: "local",
      branch,
      commit: commitSha,
    },
  }).catch(() => undefined);
  return {
    target: "repo",
    added: files.filter((f) => f.action === "add").map((f) => f.path),
    modified: files.filter((f) => f.action === "modify").map((f) => f.path),
    kept: [],
    commit: commitSha,
    branch,
    identity: who.who,
    namespace: adaptation.namespace,
    adaptation: {
      reviewerSetup: adaptation.reviewerSetup,
      limits: adaptation.limits,
      settings: adaptation.settings,
      dependenciesAdded: adaptation.dependencies.added,
      left: adaptation.packageLeft ?? [],
      packageManager: existsSync(join(c.cwd, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(c.cwd, "yarn.lock"))
          ? "yarn"
          : "npm",
    },
  };
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────────────

const tick = (ok: boolean | null) => (ok === null ? dim("–") : ok ? green("✔") : red("✖"));

function summary(
  c: Ctx,
  id: string,
  r: PlanResponse,
  w: Written,
  elapsedMs: number,
): CommandResult {
  const p = ensureProject(c.cwd);
  p.builds = [
    ...(p.builds ?? []),
    { id, target: w.target, commit: w.commit, at: new Date().toISOString() },
  ];
  writeProject(c.cwd, p);
  const gate = r.result.checks.map((x) => ({ name: x.name, ok: x.ok }));
  const gateOk = gate.length > 0 && gate.every((x) => x.ok);
  let criteria: { criterion: string; status: string; test?: string; where?: string }[] = [];
  let left: { kind: string; what: string; where: string; how: string }[] = [];
  let required: string[] = [];
  let missing: string[] = [];
  const guide = w.target === "app" ? readGuide(c.cwd) : null;
  if (guide) {
    const l = leftOf(c.cwd, guide).data as {
      left: { kind: string; what: string; where: string; how: string }[];
    };
    left = l.left.filter((x) => x.kind !== "setting");
    const openWhere = new Map(
      left.filter((x) => x.kind === "criterion").map((x) => [x.what, x.where]),
    );
    criteria = guide.criteria.map((x) => {
      const where = x.status !== "met" ? openWhere.get(x.text) : undefined;
      return {
        criterion: x.text,
        status: x.status,
        ...(x.test ? { test: `${x.test.file} › ${x.test.title}` } : {}),
        ...(where ? { where } : {}),
      };
    });
    required = guide.env.required.map((e) => e.name);
    // Packages with the zero-setup local database need no DATABASE_URL for dev and tests.
    const localDb = existsSync(join(c.cwd, "scripts/local-db.ts"));
    missing = missingSettings(
      c.cwd,
      required.filter((n) => !(localDb && n === "DATABASE_URL")),
    );
  } else if (w.adaptation) {
    left = w.adaptation.left;
    criteria = left
      .filter((x) => x.kind === "criterion")
      .map((x) => ({ criterion: x.what, status: "open", where: x.where }));
    for (const x of r.plan?.criteria ?? [])
      if (x.status === "covered" && !criteria.some((y) => y.criterion === x.criterion))
        criteria.push({
          criterion: x.criterion,
          status: gateOk ? "met" : "covered",
          test: x.tests[0] ?? "",
        });
    required = w.adaptation.settings;
    missing = missingSettings(c.cwd, required);
  }
  const met = criteria.filter((x) => x.status === "met").length;
  const open = criteria.filter((x) => x.status !== "met");
  const install =
    w.target === "app" ? "pnpm install" : `${w.adaptation?.packageManager ?? "npm"} install`;
  const next = !gateOk
    ? `${install}, then fix what \`${bin()} left\` lists and run \`${bin()} verify\``
    : left.length
      ? `${install}, then work on the ${left.length} open item(s) above (\`${bin()} left\` lists them), then \`${bin()} verify\``
      : w.target === "app"
        ? `${install} — nothing is left from the spec; only change what your task asks`
        : `${install}, wire it in following ${w.namespace}/agent/INTEGRATE.md, then \`${bin()} verify\``;
  const data = {
    id,
    target: w.target,
    state: r.state,
    commit: w.commit,
    branch: w.branch,
    gitIdentity: w.identity,
    files: {
      added: w.added.length,
      modified: w.modified,
      kept: w.kept,
      ...(w.namespace ? { folder: w.namespace } : {}),
    },
    gate: { ok: gateOk, steps: gate },
    criteria: { met, open: open.length, items: criteria },
    left,
    settings: { required, missing },
    ...(w.adaptation
      ? {
          dependenciesAdded: w.adaptation.dependenciesAdded,
          youConfigure: w.adaptation.reviewerSetup,
          limits: w.adaptation.limits,
        }
      : {}),
    note: gateOk
      ? "Already verified in the TurbineH sandbox (lint, typecheck, unit, build, E2E, security): do not re-run the whole gate; re-run only what your own change touches."
      : "The gate is not green: start with the failing steps.",
    seconds: Math.round(elapsedMs / 1000),
  };
  const lines = [
    `${gateOk ? green("✔") : yellow("!")} ${bold(guide?.app.name ?? r.plan?.capability.name ?? "Package")} — ${
      w.target === "app" ? "application" : `capability in ${w.namespace}`
    } written and committed ${w.commit.slice(0, 8)} on ${w.branch}${w.identity === "fallback" ? dim(" (as TurbineH: no git identity set)") : ""}`,
    `  ${w.added.length} files added${w.modified.length ? `, ${w.modified.length} modified (${w.modified.slice(0, 4).join(", ")})` : ""}${w.kept.length ? `, ${w.kept.length} of yours kept (package copy: ${w.kept.map((k) => k.packageCopy).join(", ")})` : ""}`,
    `  Gate: ${gate.map((g) => `${g.name} ${tick(g.ok)}`).join("  ") || "not run"}`,
    `  Criteria: ${met}/${criteria.length} met${open.length ? ` — open:` : ""}`,
    ...open.map((x) => `    - ${x.criterion}${x.where ? dim(` → ${x.where}`) : ""}`),
    ...left
      .filter((x) => x.kind !== "criterion")
      .map(
        (x) =>
          `  ${yellow("!")} ${x.what}${x.where && x.where !== "—" ? dim(` → ${x.where}`) : ""}`,
      ),
    ...(required.length
      ? [
          `  Settings: ${required.join(", ")}${missing.length ? yellow(` — missing in .env.local: ${missing.join(", ")}`) : ""}`,
        ]
      : []),
    ...(w.adaptation?.reviewerSetup.length
      ? w.adaptation.reviewerSetup.map((s) => `  ${cyan("·")} ${s}`)
      : []),
    `  ${dim(data.note)}`,
  ];
  return {
    ok: gateOk,
    command: "build",
    state: r.state,
    exitCode: gateOk ? EXIT.ok : EXIT.notGreen,
    data,
    lines,
    next,
  };
}

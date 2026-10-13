import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type pg from "pg";
import type { BackupCoder } from "@turbineh/backup-coder";
import {
  claimRepoIntegration,
  getBuild,
  githubTokenEnc,
  recordIntegration,
  updateRepoIntegration,
  type RepoIntegrationRow,
} from "@turbineh/db";
import {
  adaptPackage,
  analyseRepo,
  firstReadList,
  GENERATED_HEADER,
  github,
  GitHubError,
  isReadable,
  loadFoundation,
  mergePackageJson,
  pickAppPath,
  prBody,
  prTitle,
  repoInfo,
  secondReadList,
  type Adaptation,
  type CommitStep,
  type GitHub,
  type GlueRequest,
  type IntegrationCheck,
  type RepoAnalysis,
} from "@turbineh/engine";
import { decrypt, type createLogger, type Plan, type ProductError } from "@turbineh/shared";
import type { ArtifactStorage } from "@turbineh/storage";
import { leakingFiles } from "@turbineh/verifier";
import {
  nonRegistryDependencies,
  pmSupported,
  runSandbox,
  sanitizeProject,
  type SandboxPlan,
  type StepOutcome,
} from "./integration-sandbox.js";

/**
 * Repository integration job (PLAN §16 P5, ADR-0032): analyse the client's project → adapt the capability package to
 * its conventions (glue by the adaptation model when needed) → lockfile and migration generated in the sandbox →
 * one commit per logical step on `turbineh/<capability>` → draft pull request → verification of the PR branch in
 * the sandbox → ready for review and `integration_verified` only when every check passes; otherwise the PR stays a
 * draft with the exact failures and the next step. Never merges, never touches the default branch.
 */

type Log = ReturnType<typeof createLogger>;

export interface IntegrationDeps {
  db: pg.Pool;
  storage: ArtifactStorage;
  tokenKey: string;
  repoRoot: string;
  workerId: string;
  /** Adaptation model (strongest open coder first, ADR-0032); null when no model is configured. */
  coder: BackupCoder | null;
  appUrl: string | null;
  log: Log;
}

const err = (code: string, message: string, action: string, resume?: string): ProductError => ({
  code,
  message,
  action,
  ...(resume ? { resume } : {}),
});

class JobError extends Error {
  constructor(readonly error: ProductError) {
    super(error.message);
  }
}

// ── GitHub helpers ───────────────────────────────────────────────────────────────────────────────────────

async function download(gh: GitHub, repo: string, sha: string, dest: string): Promise<void> {
  const res = await gh.raw(`/repos/${repo}/tarball/${sha}`, "application/vnd.github+json");
  if (!res.ok)
    throw new JobError(
      err(
        "repo_download",
        `GitHub answered ${res.status} for the repository archive.`,
        "Check the connection's access to this repository and try again.",
      ),
    );
  const tgz = `${dest}.tgz`;
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    tgz,
    "-C",
    dest,
    "--strip-components=1",
    "--no-same-owner",
    "--no-same-permissions",
  ]);
  rmSync(tgz, { force: true });
}

const isText = (b: Buffer) => !b.includes(0) && Buffer.from(b.toString("utf8")).equals(b);

async function commitSteps(
  gh: GitHub,
  repo: string,
  parentSha: string,
  steps: CommitStep[],
  trailer: string,
): Promise<{ sha: string; message: string }[]> {
  const head = await gh<{ tree: { sha: string } }>(
    "GET",
    `/repos/${repo}/git/commits/${parentSha}`,
  );
  let tree = head?.tree.sha;
  let parent = parentSha;
  const out: { sha: string; message: string }[] = [];
  for (const step of steps) {
    const entries: {
      path: string;
      mode: "100644";
      type: "blob";
      content?: string;
      sha?: string;
    }[] = [];
    for (const f of step.files) {
      const data = typeof f.content === "string" ? Buffer.from(f.content) : f.content;
      if (isText(data))
        entries.push({
          path: f.path,
          mode: "100644",
          type: "blob",
          content: data.toString("utf8"),
        });
      else {
        const blob = await gh<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, {
          content: data.toString("base64"),
          encoding: "base64",
        });
        if (blob) entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }
    }
    const t = await gh<{ sha: string }>("POST", `/repos/${repo}/git/trees`, {
      base_tree: tree,
      tree: entries,
    });
    const c = await gh<{ sha: string }>("POST", `/repos/${repo}/git/commits`, {
      message: `${step.message}\n\n${trailer}`,
      tree: t?.sha,
      parents: [parent],
    });
    if (!t || !c)
      throw new JobError(err("commit_failed", "GitHub did not create the commit.", "Try again."));
    tree = t.sha;
    parent = c.sha;
    out.push({ sha: c.sha, message: step.message });
  }
  return out;
}

async function freeBranch(gh: GitHub, repo: string, slug: string): Promise<string> {
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? `turbineh/${slug}` : `turbineh/${slug}-${i}`;
    const ref = await gh("GET", `/repos/${repo}/git/ref/heads/${name}`);
    if (!ref) return name;
  }
  throw new JobError(
    err(
      "branch_exists",
      `Branches turbineh/${slug} … -20 already exist.`,
      "Delete old integration branches, then try again.",
    ),
  );
}

interface Pr {
  number: number;
  html_url: string;
  node_id: string;
  draft?: boolean;
}

async function openPr(
  gh: GitHub,
  repo: string,
  input: { title: string; head: string; base: string; body: string },
): Promise<{ pr: Pr; draft: boolean; draftUnsupported: boolean }> {
  try {
    const pr = await gh<Pr>("POST", `/repos/${repo}/pulls`, { ...input, draft: true });
    if (pr) return { pr, draft: true, draftUnsupported: false };
  } catch (e) {
    // Draft pull requests need a paid plan on private repositories: open it normally, marked as draft in the title.
    if (!(e instanceof GitHubError && e.status === 422 && /draft/i.test(e.message))) throw e;
  }
  const pr = await gh<Pr>("POST", `/repos/${repo}/pulls`, {
    ...input,
    title: `[Draft] ${input.title}`,
  });
  if (!pr)
    throw new JobError(err("pr_failed", "GitHub did not open the pull request.", "Try again."));
  return { pr, draft: false, draftUnsupported: true };
}

async function markReady(gh: GitHub, nodeId: string): Promise<boolean> {
  try {
    const r = await gh<{
      data?: { markPullRequestReadyForReview?: { pullRequest?: { isDraft: boolean } } };
    }>("POST", "/graphql", {
      query:
        "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }",
      variables: { id: nodeId },
    });
    return r?.data?.markPullRequestReadyForReview?.pullRequest?.isDraft === false;
  } catch {
    return false;
  }
}

// ── local project helpers ────────────────────────────────────────────────────────────────────────────────

const reader = (dir: string) => (p: string) => {
  if (!isReadable(p) && !/(^|\/)\.env\.(example|sample)$/.test(p)) return null;
  const f = join(dir, p);
  if (!existsSync(f) || !statSync(f).isFile() || statSync(f).size > 1_000_000) return null;
  return readFileSync(f, "utf8");
};

function analyseLocal(
  dir: string,
  paths: string[],
  repo: string,
  ref: string,
  appPath?: string,
): RepoAnalysis {
  const read = reader(dir);
  const pick = (list: string[]) =>
    Object.fromEntries(
      list.map((p) => [p, read(p)]).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  const first = pick(firstReadList(paths));
  const app = pickAppPath(first, appPath);
  const second = pick(secondReadList(paths, app, first));
  return analyseRepo({ repo, ref, paths, files: { ...first, ...second }, appPath: app });
}

function listDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else out.set(r, readFileSync(p, "utf8"));
    }
  };
  walk(dir, "");
  return out;
}

function envNames(dir: string, paths: string[]): string[] {
  const names = new Set<string>();
  for (const p of paths.filter((x) => /(^|\/)\.env\.(example|sample|template)$/.test(x))) {
    for (const l of readFileSync(join(dir, p), "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(l);
      if (m?.[1]) names.add(m[1]);
    }
  }
  return [...names];
}

// ── checks → results ─────────────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- terminal colour codes in tool output
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** The lines that explain a failure (errors first), trimmed and without terminal colours. */
export function explain(log: string, max = 4): string {
  const lines = log
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(>|\$|npm (warn|notice)|WARN|Progress|Packages:|Done in|Scope:)/i.test(l));
  const errs = lines.filter((l) => /\b(error|failed|fail|cannot|not found|ERR!|✗|×)\b/i.test(l));
  return (errs.length ? errs : lines.slice(-max)).slice(0, max).join(" · ").slice(0, 600);
}

const LABEL: Record<string, string> = {
  lockfile: "Lockfile updated with the new dependencies",
  install: "Install from the registry (scripts disabled)",
  tools: "Verification tools",
  scripts: "Install scripts (offline)",
  typecheck: "Type check",
  lint: "Lint",
  test: "Your test suite",
  "capability-tests": "Capability tests",
  migrate: "Migration applies to an empty PostgreSQL",
  build: "Production build",
  checks: "Checks",
};

export function toChecks(
  steps: StepOutcome[],
  a: Adaptation,
  base: string,
  pm: string,
): IntegrationCheck[] {
  const ns = a.namespace;
  return steps
    .filter((s) => s.name !== "tools" || s.code !== 0)
    .map((s) => {
      const ok = s.code === 0;
      const detail = ok ? `${Math.round(s.ms / 1000)}s` : explain(s.log);
      const ours = !ok && (s.log.includes(ns) || s.log.includes("turbineh/"));
      const action = ok
        ? undefined
        : s.name === "install" || s.name === "lockfile"
          ? `Check that the dependencies resolve from the public npm registry with ${pm}; private registries need credentials, which never enter the sandbox.`
          : s.name === "scripts"
            ? "A dependency's install script failed without network (e.g. it downloads binaries). Check whether your build needs it."
            : s.name === "migrate"
              ? "Review the generated migration in this pull request and your database configuration (the check uses DATABASE_URL)."
              : ours
                ? `The failure points at the capability's files in \`${ns}/\`: comment on this pull request or fix them on the branch, then re-run the integration.`
                : `The failure is in your project's own code or configuration (it may also fail on \`${base}\`); placeholder settings are used for every variable in your .env.example.`;
      return {
        name: LABEL[s.name] ?? s.name,
        ok,
        detail,
        ...(action ? { action } : {}),
      };
    });
}

// ── the job ──────────────────────────────────────────────────────────────────────────────────────────────

async function writeGlue(
  coder: BackupCoder | null,
  req: GlueRequest,
  buildId: string,
): Promise<{ content: string; by: "model" | "fallback"; model?: string; tokens?: number }> {
  if (!coder) return { content: req.fallback, by: "fallback" };
  try {
    const r = await coder.fill({
      buildId,
      trigger: "T3",
      capability: `integration glue: ${req.purpose}`,
      context: {
        contracts: Object.entries(req.context).map(([p, src]) => `// ${p}\n${src}`),
      },
      instructions: req.instructions,
      maxOutputTokens: 1500,
    });
    // Drop the model reference from the header (no provider names in client repositories).
    const body = r.code.split("\n").slice(1).join("\n").trim();
    const code = `// turbineh:generated-backup trigger=T3 (TurbineH adaptation model)\n${body.startsWith(GENERATED_HEADER) ? "" : `${GENERATED_HEADER}\n`}${body}\n`;
    const looksSecret = /(sk_live|ghp_|gho_|github_pat_|-----BEGIN)/.test(code);
    if (!new RegExp(req.mustMatch).test(code) || looksSecret || code.length > 8000)
      return { content: req.fallback, by: "fallback" };
    return {
      content: code,
      by: "model",
      model: r.model,
      tokens: r.usage.input_tokens + r.usage.output_tokens,
    };
  } catch {
    return { content: req.fallback, by: "fallback" };
  }
}

export async function processRepoIntegration(deps: IntegrationDeps): Promise<boolean> {
  const job = await claimRepoIntegration(deps.db, deps.workerId);
  if (!job) return false;
  const work = mkdtempSync(join(tmpdir(), "turbineh-int-"));
  try {
    await runJob(job, deps, work);
  } catch (e) {
    const error =
      e instanceof JobError
        ? e.error
        : e instanceof GitHubError
          ? err(
              "github",
              e.message,
              e.action,
              `turbineh apply ${job.build_id} --pr --repo ${job.repo}`,
            )
          : err(
              "integration_failed",
              "The integration stopped unexpectedly.",
              "Try again; if it repeats, download the ZIP and integrate with your coding agent.",
              `turbineh apply ${job.build_id} --pr --repo ${job.repo}`,
            );
    deps.log.error("repository integration failed", {
      integrationId: job.id,
      code: error.code,
      error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    });
    await updateRepoIntegration(deps.db, job.id, { status: "failed", phase: "failed", error });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return true;
}

async function runJob(job: RepoIntegrationRow, deps: IntegrationDeps, work: string): Promise<void> {
  const t0 = Date.now();
  const { db } = deps;
  const phase = (p: string, extra: Parameters<typeof updateRepoIntegration>[2] = {}) =>
    updateRepoIntegration(db, job.id, { phase: p, ...extra });
  const build = await getBuild(db, job.build_id, job.owner_id);
  const zipKey = (build?.artifact?.package as { zipKey?: string } | undefined)?.zipKey;
  if (!build || !zipKey)
    throw new JobError(
      err("package_not_ready", "The package is not generated.", "Generate it first."),
    );
  const enc = await githubTokenEnc(db, job.owner_id);
  if (!enc)
    throw new JobError(
      err(
        "github_not_connected",
        "GitHub is not connected for this workspace any more.",
        "Connect GitHub again, then retry the integration.",
        "turbineh connect github",
      ),
    );
  const gh = github(decrypt(enc, deps.tokenKey));
  const plan = build.metrics.plan as Plan | undefined;
  const preferredApp = (build.options.plan as { analysis?: { appPath?: string } } | undefined)
    ?.analysis?.appPath;

  // 1 · analyse the project at its base branch (archive by commit, secrets removed before anything reads it).
  await phase("analysing");
  const info = await repoInfo(gh, job.repo);
  if (!info.canPush)
    throw new JobError(
      err(
        "no_write_access",
        `The connected account cannot write to ${job.repo}.`,
        "Pick a repository you can push to, or ask for write access.",
      ),
    );
  const base = job.base ?? info.defaultBranch;
  const baseRef = await gh<{ object: { sha: string } }>(
    "GET",
    `/repos/${job.repo}/git/ref/heads/${base}`,
  );
  if (!baseRef)
    throw new JobError(
      err("base_missing", `Branch ${base} not found.`, "Pick an existing base branch."),
    );
  const baseSha = baseRef.object.sha;
  const original = join(work, "base");
  await download(gh, job.repo, baseSha, original);
  const clean = sanitizeProject(original);
  const analysis = analyseLocal(original, clean.paths, job.repo, base, preferredApp);

  // 2 · adapt the package to the project's conventions.
  await phase("adapting");
  const zip = await deps.storage.get(zipKey);
  const { foundation, versions } = loadFoundation(
    join(deps.repoRoot, "catalog/recipes/saas-crud/template"),
  );
  const adaptation = adaptPackage({
    zip,
    analysis,
    read: reader(original),
    foundation,
    versions,
    planId: job.build_id,
    need: build.prompt,
  });
  if (!adaptation.findings.compatible)
    throw new JobError(
      err(
        "incompatible_project",
        `This project cannot host the capability as is: ${adaptation.findings.conflicts[0] ?? "incompatible stack"}`,
        "Download the ZIP and adapt it with your coding agent, or pick another repository.",
      ),
    );
  const glueUsed: { path: string; by: "model" | "fallback"; model?: string; tokens?: number }[] =
    [];
  for (const g of adaptation.glue) {
    const out = await writeGlue(deps.coder, g, job.build_id);
    glueUsed.push({
      path: g.path,
      by: out.by,
      ...(out.model ? { model: out.model } : {}),
      ...(out.tokens ? { tokens: out.tokens } : {}),
    });
    for (const s of adaptation.steps)
      for (const f of s.files)
        if (f.path === g.path) {
          f.content = out.content;
          f.why =
            out.by === "model"
              ? `Adapter to your ${g.purpose.replace(/^reuse the project's /, "")}, written by the adaptation model`
              : g.fallbackWhy;
        }
  }

  // Dependencies only the fallback glue needs (e.g. its own pg pool) are added only when it is used.
  const fallbackDeps = adaptation.glue
    .filter((g) => glueUsed.find((u) => u.path === g.path)?.by === "fallback")
    .flatMap((g) => g.fallbackDependencies);
  if (fallbackDeps.length) {
    const pkgPath = analysis.appPath ? `${analysis.appPath}/package.json` : "package.json";
    let step = adaptation.steps.find((s) => s.key === "dependencies");
    const file = step?.files.find((f) => f.path === pkgPath);
    const current = file ? String(file.content) : reader(original)(pkgPath);
    if (current) {
      const m = mergePackageJson(current, fallbackDeps);
      if (m.added.length) {
        if (!step) {
          step = {
            key: "dependencies",
            message: `chore(turbineh): add dependencies of ${adaptation.slug} (exact versions)`,
            files: [],
          };
          const at = adaptation.steps.findIndex((s) => s.key === "settings");
          adaptation.steps.splice(at < 0 ? adaptation.steps.length : at, 0, step);
        }
        step.files = [
          {
            path: pkgPath,
            content: m.text,
            action: "modify",
            why: `Adds ${adaptation.dependencies.added.length + m.added.length} dependencies with exact versions (existing ones unchanged)`,
          },
        ];
        adaptation.dependencies.added.push(...m.added);
      }
    }
  }

  // 3 · lockfile and migration, generated by the project's own tools in the sandbox.
  const project = join(work, "prepare");
  mkdirSync(project, { recursive: true });
  cpSync(original, join(project, "repo"), { recursive: true });
  const repoDir = join(project, "repo");
  for (const s of adaptation.steps)
    for (const f of s.files) {
      mkdirSync(dirname(join(repoDir, f.path)), { recursive: true });
      writeFileSync(join(repoDir, f.path), f.content);
    }
  const pm = pmSupported(analysis.packageManager.name, analysis.packageManager.lockfile, repoDir);
  const unsafe = nonRegistryDependencies(repoDir, clean.paths);
  const at = (p: string) => (analysis.appPath ? `${analysis.appPath}/${p}` : p);
  const sandboxPlan = (mode: "prepare" | "verify"): SandboxPlan => ({
    mode,
    pm: pm ?? "npm",
    appPath: analysis.appPath,
    hasLockfile: Boolean(analysis.packageManager.lockfile),
    lockfile: analysis.packageManager.lockfile,
    scripts: analysis.scripts,
    typescript: analysis.language === "typescript",
    slug: adaptation.slug,
    migration: {
      kind: adaptation.migration.kind,
      dir: adaptation.migration.dir,
      config: adaptation.migration.config,
      namespace: adaptation.namespace.slice(analysis.appPath ? analysis.appPath.length + 1 : 0),
    },
    capabilityTests: adaptation.tests.files,
    tools:
      adaptation.migration.kind === "sql"
        ? { "drizzle-kit": versions["drizzle-kit"] ?? "0.31.11" }
        : {},
  });
  const names = envNames(original, clean.paths).concat(adaptation.settings);
  const prepNotes: string[] = [];
  if (pm && !unsafe.length) {
    await phase("preparing");
    const lockPath = analysis.packageManager.lockfile;
    const migDir = adaptation.migration.dir ? join(repoDir, at(adaptation.migration.dir)) : null;
    const lockBefore = lockPath ? readFileSync(join(repoDir, lockPath), "utf8") : null;
    const migBefore = migDir ? listDir(migDir) : new Map<string, string>();
    const prep = await runSandbox(project, sandboxPlan("prepare"), names);
    const extra: CommitStep[] = [];
    if (lockPath && lockBefore !== null) {
      const after = readFileSync(join(repoDir, lockPath), "utf8");
      if (after !== lockBefore)
        extra.push({
          key: "lockfile",
          message: `chore(turbineh): update ${lockPath} for ${adaptation.slug}`,
          files: [
            {
              path: lockPath,
              content: after,
              action: "modify",
              why: "Lockfile with the new dependencies (resolved by your package manager)",
            },
          ],
        });
    }
    if (migDir) {
      const changed = [...listDir(migDir)].filter(([p, c]) => migBefore.get(p) !== c);
      if (changed.length)
        extra.push({
          key: "migration",
          message: `feat(turbineh): database migration for ${adaptation.slug}`,
          files: changed.map(([p, c]) => ({
            path: at(`${adaptation.migration.dir}/${p}`),
            content: c,
            action: migBefore.has(p) ? ("modify" as const) : ("add" as const),
            why: "Migration generated with drizzle-kit for the capability's tables",
          })),
        });
    }
    adaptation.steps.push(...extra);
    for (const s of prep.filter((x) => x.code !== 0))
      prepNotes.push(
        `${LABEL[s.name] ?? s.name} could not run before committing: ${explain(s.log, 2)}`,
      );
  } else if (!pm) {
    prepNotes.push(
      `${analysis.packageManager.name ?? "This package manager"} is not supported in the sandbox yet (pnpm, npm and Yarn classic are): the lockfile was not updated and the checks cannot run.`,
    );
  } else {
    prepNotes.push(
      `Dependencies from outside the npm registry were found (${unsafe.slice(0, 3).join("; ")}): the sandbox installs from the registry only, so nothing was installed.`,
    );
  }
  adaptation.limits.push(...prepNotes);
  if (clean.removed.length)
    adaptation.limits.push(
      `${clean.removed.length} committed secret-like file(s) (env files, keys, registry credentials) were left out of the analysis and the sandbox.`,
    );

  // 4 · commits (one per logical step) on a new branch, then a draft pull request.
  await phase("committing");
  const branch = await freeBranch(gh, job.repo, adaptation.slug);
  const commits = await commitSteps(
    gh,
    job.repo,
    baseSha,
    adaptation.steps,
    `TurbineH integration ${job.id} (plan ${job.build_id.slice(0, 8)})`,
  );
  const headSha = commits.at(-1)?.sha ?? baseSha;
  await gh("POST", `/repos/${job.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: headSha });
  const flowUrl = deps.appUrl ? `${deps.appUrl}/flows/${job.build_id}` : undefined;
  const bodyInput = {
    need: build.prompt,
    planId: job.build_id,
    adaptation,
    analysis,
    commits,
    glue: glueUsed,
    ...(flowUrl ? { flowUrl } : {}),
  };
  const { pr, draft, draftUnsupported } = await openPr(gh, job.repo, {
    title: prTitle(adaptation),
    head: branch,
    base,
    body: prBody({ ...bodyInput, verification: { state: "running" } }),
  });
  const integrated = {
    id: job.id,
    state: "integrated",
    at: new Date().toISOString(),
    where: "github",
    repo: job.repo,
    branch,
    commit: headSha,
    pullRequest: pr.html_url,
  };
  await recordIntegration(db, job.build_id, job.owner_id, integrated);
  await phase("verifying", {
    state: "integrated",
    branch,
    pr_url: pr.html_url,
    pr_number: pr.number,
    draft: draft || draftUnsupported,
  });

  // 5 · verify the pull request's head inside the project, in the sandbox.
  const verifyDir = join(work, "verify");
  mkdirSync(verifyDir, { recursive: true });
  await download(gh, job.repo, headSha, join(verifyDir, "repo"));
  const vclean = sanitizeProject(join(verifyDir, "repo"));
  let steps: StepOutcome[] = [];
  if (pm && !unsafe.length) steps = await runSandbox(verifyDir, sandboxPlan("verify"), names);
  const checks = toChecks(steps, adaptation, base, pm ?? "npm");
  if (!pm || unsafe.length)
    checks.push({
      name: "Install",
      ok: false,
      detail: prepNotes.at(-1) ?? "not run",
      action:
        "Integrate with your coding agent from the ZIP, or use pnpm/npm/Yarn classic with registry dependencies.",
    });
  // Our own checks on the pull request itself.
  const changed = commits.length
    ? ((
        (await gh<{ files?: { filename: string }[] }>(
          "GET",
          `/repos/${job.repo}/compare/${baseSha}...${headSha}`,
        )) ?? {}
      ).files?.map((f) => f.filename) ?? [])
    : [];
  const planned = new Set(adaptation.steps.flatMap((s) => s.files.map((f) => f.path)));
  const outside = changed.filter((p) => !planned.has(p));
  checks.push({
    name: "Only planned files changed",
    ok: outside.length === 0,
    detail: outside.length
      ? `Unexpected: ${outside.slice(0, 5).join(", ")}`
      : `${changed.length} files, all listed below`,
    ...(outside.length
      ? {
          action:
            "Close this pull request and report it: the integration must never touch other files.",
        }
      : {}),
  });
  try {
    const leaks = leakingFiles(
      join(verifyDir, "repo"),
      changed.filter((p) => vclean.paths.includes(p)),
    );
    checks.push({
      name: "No secrets in the changes",
      ok: leaks.length === 0,
      detail: leaks.length
        ? `Possible secret in ${leaks.join(", ")}`
        : "gitleaks on every changed file",
      ...(leaks.length ? { action: "Remove the value from the file and rotate it." } : {}),
    });
  } catch {
    checks.push({
      name: "No secrets in the changes",
      ok: null,
      detail: "scanner unavailable on this worker",
    });
  }
  const passed =
    checks.every((c) => c.ok !== false) && steps.some((s) => s.name === "install" && s.code === 0);
  const seconds = Math.round((Date.now() - t0) / 1000);
  let ready = false;
  if (passed) ready = draftUnsupported ? true : await markReady(gh, pr.node_id);
  await gh("PATCH", `/repos/${job.repo}/pulls/${pr.number}`, {
    body: prBody({
      ...bodyInput,
      verification: { state: passed ? "passed" : "failed", checks, seconds },
    }),
    ...(draftUnsupported
      ? { title: passed ? prTitle(adaptation) : `[Draft] ${prTitle(adaptation)}` }
      : {}),
  });
  const state = passed ? "integration_verified" : "integrated";
  const recordChecks = checks.map((c) => ({
    name: c.name,
    ok: c.ok !== false,
    detail: c.detail.slice(0, 300),
  }));
  await recordIntegration(db, job.build_id, job.owner_id, {
    ...integrated,
    state,
    at: new Date().toISOString(),
    checks: recordChecks,
  });
  const failed = checks.filter((c) => c.ok === false);
  await updateRepoIntegration(db, job.id, {
    status: "done",
    phase: "done",
    state,
    draft: !(passed && ready),
    result: {
      seconds,
      base,
      appPath: analysis.appPath,
      namespace: adaptation.namespace,
      commits,
      checks,
      decisions: adaptation.decisions,
      conflicts: adaptation.findings.conflicts,
      limits: adaptation.limits,
      reviewerSetup: adaptation.reviewerSetup,
      dependencies: adaptation.dependencies,
      settings: adaptation.settings,
      glue: glueUsed.map(({ path, by }) => ({ path, by })),
      plan: plan ? { capability: plan.capability.name } : null,
    },
    error: passed
      ? null
      : err(
          "integration_not_verified",
          `${failed.length} check(s) failed inside your project: ${failed.map((c) => c.name).join(", ")}.`,
          failed[0]?.action ?? "Review the failures in the pull request.",
          `turbineh apply ${job.build_id} --pr --repo ${job.repo}`,
        ),
  });
  deps.log.info("repository integration finished", {
    integrationId: job.id,
    state,
    seconds,
    checks: checks.length,
    failed: failed.length,
  });
}

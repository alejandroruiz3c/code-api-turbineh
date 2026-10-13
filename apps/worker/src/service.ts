/**
 * Worker service: claims queued builds from Postgres (SKIP LOCKED), runs the pipeline, stores the channel-A
 * artefact (zip + git bundle + file list + docs) and records the result. Run several instances to scale.
 *
 *   pnpm --filter @turbineh/worker run service
 */
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SelectionResult } from "@turbineh/selector";
import {
  addCost,
  claimBuild,
  costToday,
  emitEvent,
  finishBuild,
  getBuild,
  getCachedSelection,
  getPool,
  heartbeat,
  putCachedSelection,
  requeueForGeneration,
  requeueStale,
  requeueStaleRepoIntegrations,
  type BuildRow,
} from "@turbineh/db";
import { deciderFromEnv } from "@turbineh/decider";
import { createLogger, loadLocalEnv, readEnv } from "@turbineh/shared";
import { storageFromEnv, type ArtifactStorage } from "@turbineh/storage";
import { buildCost } from "./cost.js";
import { processDeployment } from "./deploy-job.js";
import { processDelivery } from "./delivery.js";
import { adaptationCoderFromEnv, modelSlotsFromEnv } from "./models.js";
import { processRepoIntegration } from "./repo-integration.js";
import {
  forcedFailureRequested,
  improveBuild,
  runBuild,
  type BuildOutcome,
  type Phase,
  type PipelineDeps,
} from "./pipeline.js";
import { isGapNotice } from "@turbineh/engine";
import { storeCapabilityPackage, type PlanRequest } from "./product.js";
import { generateComponentPackage } from "./component-package.js";
import { runContracts } from "@turbineh/curation";
import type { BuildSpec } from "@turbineh/compiler";
import { trackedTokens } from "@turbineh/engine";
import type { Plan } from "@turbineh/shared";

loadLocalEnv();
const env = readEnv();
const log = createLogger("worker");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const db = getPool(env.DATABASE_URL);
const storage = storageFromEnv(process.env, join(repoRoot, "artifacts"));
const decider = deciderFromEnv(env);
const workerId = `${hostname()}-${process.pid}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);
const DAILY_CAP_EUR = Number(process.env.DAILY_COST_CAP_EUR ?? 100);
/** Per-build overhead for costs not metered per build (decider, writer, fixer, compute). */
const COST_OVERHEAD_EUR = Number(process.env.COST_OVERHEAD_EUR_PER_BUILD ?? 0.01);
const DOCS = [
  "DEPLOYED.md",
  "TURBINEH_REPORT.md",
  "DEPLOY.md",
  "SECURITY.md",
  "README.md",
  "COMPONENTS.md",
  "ARCHITECTURE.md",
];

/** Channel A artefact: everything a user needs even if GitHub is unavailable. */
async function storeArtifact(
  build: BuildRow,
  repoDir: string,
  store: ArtifactStorage,
): Promise<Record<string, unknown>> {
  const slug = repoDir.split("/").pop() ?? "app";
  const zip = execFileSync("git", ["archive", "--format=zip", `--prefix=${slug}/`, "HEAD"], {
    cwd: repoDir,
    maxBuffer: 256 * 1024 * 1024,
  });
  const bundlePath = join(repoDir, "..", `${slug}.bundle`);
  execFileSync("git", ["bundle", "create", bundlePath, "--all"], { cwd: repoDir, stdio: "pipe" });
  const files = execFileSync("git", ["ls-files"], { cwd: repoDir })
    .toString()
    .split("\n")
    .filter(Boolean);
  const docs = Object.fromEntries(
    DOCS.filter((f) => files.includes(f)).map((f) => [
      f,
      readFileSync(join(repoDir, f), "utf8").slice(0, 60_000),
    ]),
  );
  const zipKey = `builds/${build.id}/${slug}.zip`;
  const bundleKey = `builds/${build.id}/${slug}.bundle`;
  await store.put(zipKey, zip, "application/zip");
  await store.put(bundleKey, readFileSync(bundlePath), "application/octet-stream");
  // Screen previews captured by the verification (not part of the repository: .gitignore).
  const previewDir = join(repoDir, ".turbineh-previews");
  const previews: { name: string; key: string }[] = [];
  if (existsSync(previewDir)) {
    for (const f of readdirSync(previewDir)
      .filter((x) => /^[\w-]+\.png$/.test(x))
      .sort()
      .slice(0, 6)) {
      const key = `builds/${build.id}/previews/${f}`;
      await store.put(key, readFileSync(join(previewDir, f)), "image/png");
      previews.push({ name: f.replace(/^\d-/, "").replace(/\.png$/, ""), key });
    }
  }
  return { slug, zipKey, bundleKey, files, docs, previews, sizeBytes: zip.length };
}

async function handle(build: BuildRow): Promise<void> {
  log.info("build claimed", { buildId: build.id });
  const pipelineDeps = {
    repoRoot,
    buildsDir: join(repoRoot, "builds"),
    // Flywheel records outside the deployed tree (deploys replace the repository copy).
    ...(process.env.GAPS_DIR ? { gapsDir: process.env.GAPS_DIR } : {}),
    decider,
    selectionCache: {
      get: (key: string) => getCachedSelection<SelectionResult>(db, key),
      put: (key: string, result: SelectionResult) => putCachedSelection(db, key, result),
    },
    // Glue that already passed the full gate in an earlier build (same component, version and capability).
    glueCache: {
      get: (key: string) => getCachedSelection<{ content: string }>(db, key, 30),
      put: (key: string, content: string) => putCachedSelection(db, key, { content }),
    },
    ...modelSlotsFromEnv(env),
    compiler: {
      baseURL: env.COMPILER_BASE_URL,
      model: env.COMPILER_MODEL,
      ...(env.COMPILER_API_KEY ? { apiKey: env.COMPILER_API_KEY } : {}),
      ...(env.MODEL_REASONING_EFFORT ? { reasoningEffort: env.MODEL_REASONING_EFFORT } : {}),
    },
    emit: (_id: string, phase: Phase, type: string, data: Record<string, unknown>) =>
      emitEvent(db, build.id, phase, type, data),
  };
  const parentId = typeof build.options.parent === "string" ? build.options.parent : null;
  const mode = build.options.mode;
  // Product flows (PLAN §16.4): the same row first carries the plan, then the generation from that plan.
  const plan = build.metrics.plan as Plan | undefined;
  const componentOnly = mode === "generate" && plan?.capability.kind === "component";
  const outcome =
    componentOnly && plan
      ? await generateComponentPackage(build.id, plan, {
          repoRoot,
          storage,
          emit: (phase, type, data) => emitEvent(db, build.id, phase, type, data),
          runContracts,
        })
      : build.options.mode === "improve" && parentId
        ? await improveFromParent(build, parentId, pipelineDeps)
        : await runBuild(build.prompt, pipelineDeps, build.id, {
            brand: build.options.brand,
            ...(mode === "plan" ? { plan: build.options.plan as PlanRequest } : {}),
            ...(mode === "generate" && build.spec ? { spec: build.spec as BuildSpec } : {}),
            ...(forcedFailureRequested(build.prompt, process.env) ? { forceFailure: true } : {}),
          });
  if (mode === "generate" && plan) outcome.metrics = { ...outcome.metrics, plan };
  let artifact: Record<string, unknown> | undefined;
  if (componentOnly) {
    artifact = outcome.metrics.artifact as Record<string, unknown>;
    delete outcome.metrics.artifact;
  }
  // ADR-0037 §D1: never deliver nothing. A failed gate with only quality failures still delivers the package (marked
  // not verified, status stays "failed"); a security or policy block delivers only the report.
  const unverified = outcome.status === "failed" && outcome.delivery?.kind === "unverified";
  if (outcome.status === "failed" && outcome.delivery?.kind === "report_only" && outcome.repoDir) {
    artifact = reportOnlyArtifact(outcome.repoDir, outcome.delivery.label);
    await emitEvent(db, build.id, "delivering", "done", { channel: "A", reportOnly: true });
  }
  if ((outcome.status === "done" || unverified) && outcome.repoDir) {
    await emitEvent(db, build.id, "delivering", "start", { channel: "A", verified: !unverified });
    artifact = await storeArtifact(build, outcome.repoDir, storage);
    artifact.verified = !unverified;
    // The capability package (PLAN §16.3) is the product deliverable: ZIP or changes in a repository.
    artifact.package = await packageFlow(build, outcome, artifact, plan).catch((err: unknown) => {
      log.error("capability package failed", { buildId: build.id, error: String(err) });
      return undefined;
    });
    await emitEvent(db, build.id, "delivering", "done", {
      channel: "A",
      files: (artifact.files as string[]).length,
      package: Boolean(artifact.package),
    });
  }
  const cost = buildCost(outcome.metrics, env.COMPILER_MODEL, COST_OVERHEAD_EUR);
  outcome.metrics.cost = cost;
  await addCost(db, cost.totalEur);
  await finishBuild(db, build.id, {
    status: outcome.status,
    ...(outcome.spec ? { spec: outcome.spec } : {}),
    metrics: {
      ...outcome.metrics,
      verify: outcome.verify?.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms })),
    },
    ...(artifact ? { artifact } : {}),
    ...(outcome.reason ? { error: outcome.reason } : {}),
  });
  await emitEvent(db, build.id, outcome.status, "finished", {
    status: outcome.status,
    reason: outcome.reason ?? null,
  });
  log.info("build finished", { buildId: build.id, status: outcome.status });
  // `turbineh build` (ADR-0036): a plan asked to continue straight into generation goes back to the queue at once
  // when nobody has to decide anything (TurbineH writing an uncovered part is what the build asked for) — no second
  // request, no client poll interval in between.
  const planned = outcome.metrics.plan as Plan | undefined;
  if (
    mode === "plan" &&
    build.options.autoGenerate === true &&
    outcome.status === "done" &&
    planned &&
    planned.needsApproval.every(isGapNotice) &&
    build.owner_id &&
    (await costToday(db)).eur < DAILY_CAP_EUR
  ) {
    await requeueForGeneration(db, build.id, build.owner_id);
    log.info("plan continues into generation", { buildId: build.id });
  }
}

/** Report-only delivery (security or policy block): the reports, never runnable code. */
function reportOnlyArtifact(repoDir: string, label: string): Record<string, unknown> {
  const slug = repoDir.split("/").pop() ?? "app";
  const docs = Object.fromEntries(
    ["TURBINEH_REPORT.md", "SECURITY.md"]
      .filter((f) => existsSync(join(repoDir, f)))
      .map((f) => [f, readFileSync(join(repoDir, f), "utf8").slice(0, 60_000)]),
  );
  return { slug, docs, files: [], reportOnly: true, verified: false, label };
}

/** Capability package of a generated app (complete flow): "verified" only when every check passed. */
async function packageFlow(
  build: BuildRow,
  outcome: BuildOutcome,
  artifact: Record<string, unknown>,
  plan: Plan | undefined,
): Promise<Record<string, unknown>> {
  const verify = (outcome.verify?.steps ?? []).map((x) => ({ name: x.name, ok: x.ok }));
  const spec = outcome.spec as { slug?: string; app_name?: string; summary?: string } | undefined;
  const m = outcome.metrics;
  const docs = Object.fromEntries(
    Object.entries((artifact.docs ?? {}) as Record<string, string>)
      .filter(([k]) => ["TURBINEH_REPORT.md", "SECURITY.md", "DEPLOY.md"].includes(k))
      .map(([k, v]) => [k.toLowerCase().replace("turbineh_", ""), v]),
  );
  const pkg = await storeCapabilityPackage(
    build.id,
    storage,
    {
      slug: spec?.slug ?? String(artifact.slug),
      name: spec?.app_name ?? String(artifact.slug),
      need: plan?.need ?? build.prompt,
      planId: build.id,
      state: verify.length > 0 && verify.every((x) => x.ok) ? "verified" : "generated",
      summary: spec?.summary ?? build.prompt,
      components: (plan?.components ?? []).map((c) => ({
        ...c,
        purl: "",
        capability: plan?.decisions.find((d) => d.choice === c.id)?.topic ?? c.id,
      })),
      checks: verify,
      ...(plan ? { plan } : {}),
      metrics: {
        seconds: Math.round(((m.timings as { total?: number } | undefined)?.total ?? 0) / 1000),
        tokens: trackedTokens(m),
        reusedShare: (m.reuse as { reusedShare?: number } | undefined)?.reusedShare ?? 0,
        newLines: (m.reuse as { generatedLines?: number } | undefined)?.generatedLines ?? 0,
        securityFindings: Number((m.handover as { alerts?: number } | undefined)?.alerts ?? 0),
      },
      docs,
    },
    { appDir: outcome.repoDir ?? "" },
  );
  return pkg;
}

/** Restores the parent build's repository from its git bundle and runs "improve and redeliver" on a copy. */
async function improveFromParent(
  build: BuildRow,
  parentId: string,
  deps: PipelineDeps,
): Promise<BuildOutcome> {
  const parent = await getBuild(db, parentId, build.owner_id ?? undefined);
  const art = parent?.artifact as { bundleKey?: string; slug?: string } | null | undefined;
  if (!parent || parent.status !== "done" || !art?.bundleKey) {
    return {
      buildId: build.id,
      status: "failed",
      reason: "original build not available for improvement",
      metrics: {},
    };
  }
  const dir = join(repoRoot, "builds", build.id);
  mkdirSync(dir, { recursive: true });
  const bundle = join(dir, "parent.bundle");
  writeFileSync(bundle, await storage.get(art.bundleKey));
  const repoDir = join(dir, art.slug ?? "app");
  execFileSync("git", ["clone", "--quiet", bundle, repoDir], { stdio: "pipe" });
  await emitEvent(db, build.id, "assembling", "done", { improvedFrom: parentId });
  return improveBuild(
    repoDir,
    {
      spec: parent.spec as Parameters<typeof improveBuild>[1]["spec"],
      metrics: { ...parent.metrics, buildId: parentId },
    },
    deps,
    build.id,
  );
}

let running = 0;
/** Set on SIGTERM/SIGINT: no new work is claimed; running builds, deliveries and deployments finish first. */
let stopping = false;
let busyJobs = 0;
/** Below this free space a build would fail at install: leave it in the queue for a worker that has room. */
const MIN_FREE_GB = Number(process.env.MIN_FREE_DISK_GB ?? 15);
let lowDiskLogged = 0;
function diskFreeGb(): number {
  const st = statfsSync(repoRoot);
  return (st.bavail * st.bsize) / 1024 ** 3;
}
async function tick(): Promise<void> {
  if (stopping || running >= CONCURRENCY) return;
  const free = diskFreeGb();
  if (free < MIN_FREE_GB) {
    if (Date.now() - lowDiskLogged > 10 * 60_000) {
      lowDiskLogged = Date.now();
      log.warn("low disk: not claiming new builds", {
        freeGb: Math.round(free),
        minGb: MIN_FREE_GB,
      });
    }
    return;
  }
  if ((await costToday(db)).eur >= DAILY_CAP_EUR) {
    log.warn("daily cost cap reached; not claiming new builds", { cap: DAILY_CAP_EUR });
    return;
  }
  const build = await claimBuild(db, workerId);
  if (!build) return;
  running++;
  handle(build)
    .catch(async (err: unknown) => {
      log.error("build crashed", {
        buildId: build.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await finishBuild(db, build.id, { status: "failed", metrics: {}, error: "internal error" });
      await emitEvent(db, build.id, "failed", "finished", {
        status: "failed",
        reason: "internal error",
      });
    })
    .finally(() => {
      running--;
    });
}

// A failure inside one build must never take down the others running in this process.
process.on("unhandledRejection", (reason: unknown) => {
  log.error("unhandled rejection", { error: String(reason).slice(0, 500) });
});
log.info("worker started", { workerId, concurrency: CONCURRENCY });
setInterval(() => void requeueStale(db).catch(() => undefined), 60_000);
const beat = () => void heartbeat(db, workerId, running).catch(() => undefined);
beat();
setInterval(beat, 30_000);
const tokenKey = process.env.DELIVERY_TOKEN_KEY;
if (tokenKey) {
  // Deliveries are short and I/O-bound: a separate loop so they never wait behind builds.
  void (async () => {
    while (!stopping) {
      busyJobs++;
      const worked = await processDelivery(db, storage, tokenKey)
        .catch((err: unknown) => {
          log.error("delivery loop failed", { error: String(err) });
          return false;
        })
        .finally(() => busyJobs--);
      if (!worked) await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  // Repository integrations (PLAN §16 P5): analyse → adapt → commit → draft PR → verify in the sandbox.
  const integrationDeps = {
    db,
    storage,
    tokenKey,
    repoRoot,
    workerId,
    coder: adaptationCoderFromEnv(env),
    decider,
    appUrl: process.env.PRODUCT_APP_URL ?? null,
    log,
  };
  setInterval(() => void requeueStaleRepoIntegrations(db).catch(() => undefined), 5 * 60_000);
  void (async () => {
    while (!stopping) {
      busyJobs++;
      const worked = await processRepoIntegration(integrationDeps)
        .catch((err: unknown) => {
          log.error("integration loop failed", { error: String(err).slice(0, 300) });
          return false;
        })
        .finally(() => busyJobs--);
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    }
  })();
  // "Deploy for me": own loop (minutes per job, mostly waiting on the client's Vercel build).
  void (async () => {
    while (!stopping) {
      busyJobs++;
      const worked = await processDeployment(db, storage, tokenKey, async (buildId, repoDir) => {
        const build = await getBuild(db, buildId);
        if (!build) throw new Error("build not found");
        return storeArtifact(build, repoDir, storage);
      })
        .catch((err: unknown) => {
          log.error("deployment loop failed", { error: String(err) });
          return false;
        })
        .finally(() => busyJobs--);
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    }
  })();
} else {
  log.warn("DELIVERY_TOKEN_KEY not set: GitHub deliveries and deployments disabled");
}
/** Graceful stop (deploys, the AWS schedule): finish what is running, up to DRAIN_TIMEOUT_MS, then exit. */
const DRAIN_TIMEOUT_MS = Number(process.env.DRAIN_TIMEOUT_MS ?? 25 * 60_000);
function drain(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info("stopping: no new builds; finishing running work", { signal, running, busyJobs });
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  const check = setInterval(() => {
    if ((running === 0 && busyJobs === 0) || Date.now() > deadline) {
      clearInterval(check);
      void heartbeat(db, workerId, 0)
        .catch(() => undefined)
        .finally(() => {
          log.info("stopped", { unfinished: running });
          process.exit(0);
        });
    }
  }, 1000);
}
process.on("SIGTERM", () => drain("SIGTERM"));
process.on("SIGINT", () => drain("SIGINT"));

while (!stopping) {
  await tick().catch((err: unknown) => log.error("tick failed", { error: String(err) }));
  await new Promise((r) => setTimeout(r, running >= CONCURRENCY ? 1000 : 500));
}

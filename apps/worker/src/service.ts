/**
 * Worker service: claims queued builds from Postgres (SKIP LOCKED), runs the pipeline, stores the channel-A
 * artefact (zip + git bundle + file list + docs) and records the result. Run several instances to scale.
 *
 *   pnpm --filter @turbineh/worker run service
 */
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCost,
  claimBuild,
  costToday,
  emitEvent,
  finishBuild,
  getBuild,
  getPool,
  heartbeat,
  requeueStale,
  type BuildRow,
} from "@turbineh/db";
import { deciderFromEnv } from "@turbineh/decider";
import { createLogger, loadLocalEnv, readEnv } from "@turbineh/shared";
import { storageFromEnv, type ArtifactStorage } from "@turbineh/storage";
import { buildCost } from "./cost.js";
import { processDeployment } from "./deploy-job.js";
import { processDelivery } from "./delivery.js";
import { modelSlotsFromEnv } from "./models.js";
import {
  improveBuild,
  runBuild,
  type BuildOutcome,
  type Phase,
  type PipelineDeps,
} from "./pipeline.js";

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
  const outcome =
    build.options.mode === "improve" && parentId
      ? await improveFromParent(build, parentId, pipelineDeps)
      : await runBuild(build.prompt, pipelineDeps, build.id, { brand: build.options.brand });
  let artifact: Record<string, unknown> | undefined;
  if (outcome.status === "done" && outcome.repoDir) {
    await emitEvent(db, build.id, "delivering", "start", { channel: "A" });
    artifact = await storeArtifact(build, outcome.repoDir, storage);
    await emitEvent(db, build.id, "delivering", "done", {
      channel: "A",
      files: (artifact.files as string[]).length,
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
async function tick(): Promise<void> {
  if (running >= CONCURRENCY) return;
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

log.info("worker started", { workerId, concurrency: CONCURRENCY });
setInterval(() => void requeueStale(db).catch(() => undefined), 60_000);
const beat = () => void heartbeat(db, workerId, running).catch(() => undefined);
beat();
setInterval(beat, 30_000);
const tokenKey = process.env.DELIVERY_TOKEN_KEY;
if (tokenKey) {
  // Deliveries are short and I/O-bound: a separate loop so they never wait behind builds.
  void (async () => {
    for (;;) {
      const worked = await processDelivery(db, storage, tokenKey).catch((err: unknown) => {
        log.error("delivery loop failed", { error: String(err) });
        return false;
      });
      if (!worked) await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  // "Deploy for me": own loop (minutes per job, mostly waiting on the client's Vercel build).
  void (async () => {
    for (;;) {
      const worked = await processDeployment(db, storage, tokenKey, async (buildId, repoDir) => {
        const build = await getBuild(db, buildId);
        if (!build) throw new Error("build not found");
        return storeArtifact(build, repoDir, storage);
      }).catch((err: unknown) => {
        log.error("deployment loop failed", { error: String(err) });
        return false;
      });
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    }
  })();
} else {
  log.warn("DELIVERY_TOKEN_KEY not set: GitHub deliveries and deployments disabled");
}
for (;;) {
  await tick().catch((err: unknown) => log.error("tick failed", { error: String(err) }));
  await new Promise((r) => setTimeout(r, running >= CONCURRENCY ? 1000 : 500));
}

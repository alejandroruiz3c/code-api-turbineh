/**
 * Worker service: claims queued builds from Postgres (SKIP LOCKED), runs the pipeline, stores the channel-A
 * artefact (zip + git bundle + file list + docs) and records the result. Run several instances to scale.
 *
 *   pnpm --filter @turbineh/worker run service
 */
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCost,
  claimBuild,
  costToday,
  emitEvent,
  finishBuild,
  getPool,
  requeueStale,
  type BuildRow,
} from "@turbineh/db";
import { deciderFromEnv } from "@turbineh/decider";
import { createLogger, loadLocalEnv, readEnv } from "@turbineh/shared";
import { storageFromEnv, type ArtifactStorage } from "@turbineh/storage";
import { runBuild, type Phase } from "./pipeline.js";

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
const EST_EUR_PER_BUILD = Number(process.env.EST_COST_EUR_PER_BUILD ?? 0.02);
const DOCS = ["README.md", "COMPONENTS.md", "ARCHITECTURE.md", "SECURITY.md", "TURBINEH_REPORT.md"];

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
  return { slug, zipKey, bundleKey, files, docs, sizeBytes: zip.length };
}

async function handle(build: BuildRow): Promise<void> {
  log.info("build claimed", { buildId: build.id });
  const outcome = await runBuild(
    build.prompt,
    {
      repoRoot,
      buildsDir: join(repoRoot, "builds"),
      decider,
      compiler: {
        baseURL: env.COMPILER_BASE_URL,
        model: env.COMPILER_MODEL,
        ...(env.COMPILER_API_KEY ? { apiKey: env.COMPILER_API_KEY } : {}),
        ...(env.MODEL_REASONING_EFFORT ? { reasoningEffort: env.MODEL_REASONING_EFFORT } : {}),
      },
      emit: (_id, phase: Phase, type, data) => emitEvent(db, build.id, phase, type, data),
    },
    build.id,
  );
  let artifact: Record<string, unknown> | undefined;
  if (outcome.status === "done" && outcome.repoDir) {
    await emitEvent(db, build.id, "delivering", "start", { channel: "A" });
    artifact = await storeArtifact(build, outcome.repoDir, storage);
    await emitEvent(db, build.id, "delivering", "done", {
      channel: "A",
      files: (artifact.files as string[]).length,
    });
  }
  await addCost(db, EST_EUR_PER_BUILD);
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
for (;;) {
  await tick().catch((err: unknown) => log.error("tick failed", { error: String(err) }));
  await new Promise((r) => setTimeout(r, running >= CONCURRENCY ? 1000 : 500));
}

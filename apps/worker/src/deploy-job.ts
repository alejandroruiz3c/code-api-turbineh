import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import {
  deployedGuide,
  startHereHtml,
  type HandoverFacts,
  type LiveInfo,
} from "@turbineh/assembler";
import { emitEvent } from "@turbineh/db";
import { deployToClient } from "@turbineh/deployer";
import { decrypt } from "@turbineh/shared";
import type { ArtifactStorage } from "@turbineh/storage";

interface DeploymentRow {
  id: string;
  build_id: string;
  vercel_token_enc: string;
  vercel_team_id: string | null;
  db_mode: "neon" | "url";
  db_secret_enc: string;
  admin_email: string | null;
  vercel_via: "token" | "integration";
  artifact: { bundleKey?: string; slug?: string } | null;
  metrics: Record<string, unknown>;
  spec: { app_name?: string; summary?: string } | null;
}

const ERASE = "vercel_token_enc = NULL, db_secret_enc = NULL, finished_at = now()";

/**
 * "Deploy for me" (ADR-0017): claims one queued deployment, deploys the delivered repository into the client's own
 * Vercel account and database, adapts the deliverables (DEPLOYED.md, START_HERE.html) and stores the new package.
 * Client credentials are erased when the job ends, whatever the outcome.
 */
export async function processDeployment(
  db: pg.Pool,
  storage: ArtifactStorage,
  tokenKey: string,
  storeArtifact: (buildId: string, repoDir: string) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const claimed = await db.query<DeploymentRow>(
    `UPDATE deployments d SET status = 'running', step = 'Starting'
     FROM builds b
     WHERE d.id = (SELECT id FROM deployments WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       AND b.id = d.build_id
     RETURNING d.id, d.build_id, d.vercel_token_enc, d.vercel_team_id, d.db_mode, d.db_secret_enc, d.admin_email, d.vercel_via,
               b.artifact, b.metrics, b.spec`,
  );
  const job = claimed.rows[0];
  if (!job) return false;
  const work = mkdtempSync(join(tmpdir(), "turbineh-deploy-"));
  const step = async (s: string) => {
    await db.query("UPDATE deployments SET step = $2 WHERE id = $1", [job.id, s]);
    await emitEvent(db, job.build_id, "deploying", "step", { step: s });
  };
  try {
    if (!job.artifact?.bundleKey) throw new Error("the package of this build is not available");
    const slug = job.artifact.slug ?? "app";
    const bundle = join(work, "app.bundle");
    writeFileSync(bundle, await storage.get(job.artifact.bundleKey));
    const repoDir = join(work, slug);
    execFileSync("git", ["clone", "--quiet", bundle, repoDir], { stdio: "pipe" });

    const secret = decrypt(job.db_secret_enc, tokenKey);
    const result = await deployToClient({
      repoDir,
      slug,
      buildId: job.build_id,
      vercel: {
        token: decrypt(job.vercel_token_enc, tokenKey),
        ...(job.vercel_team_id ? { teamId: job.vercel_team_id } : {}),
      },
      database:
        job.db_mode === "neon" ? { mode: "neon", apiKey: secret } : { mode: "url", url: secret },
      ...(job.admin_email ? { adminEmail: job.admin_email } : {}),
      onStep: step,
    });

    await step("Updating your documents");
    const live: LiveInfo = {
      ...result,
      deployedAt: new Date().toISOString(),
      viaIntegration: job.vercel_via === "integration",
    };
    const appName = job.spec?.app_name ?? slug;
    const handover = (job.metrics.handover as HandoverFacts | undefined) ?? {
      appName,
      summary: job.spec?.summary ?? "",
      verified: true,
      checksPassed: 0,
      checksTotal: 0,
      criteriaVerified: 0,
      criteriaTotal: 0,
      alerts: 0,
      fixedBeforeDelivery: 0,
    };
    writeFileSync(
      join(repoDir, "DEPLOYED.md"),
      `<!-- turbineh:generated -->\n${deployedGuide(appName, live)}`,
    );
    writeFileSync(join(repoDir, "START_HERE.html"), startHereHtml({ ...handover, live }));
    const readme = readFileSync(join(repoDir, "README.md"), "utf8");
    if (!readme.includes("DEPLOYED.md")) {
      writeFileSync(
        join(repoDir, "README.md"),
        readme.replace(
          /\n> \*\*Start here:\*\*[^\n]*\n/,
          `\n> **Live:** ${result.url} — see [DEPLOYED.md](DEPLOYED.md). **Start here:** [START_HERE.html](START_HERE.html).\n`,
        ),
      );
    }
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CODE-API-TURBINEH",
        "-c",
        "user.email=builds@turbineh.com",
        "commit",
        "-q",
        "-m",
        "docs: deployed for you by TurbineH",
      ],
      { cwd: repoDir },
    );
    const artifact = await storeArtifact(job.build_id, repoDir);
    await db.query(
      `UPDATE builds SET artifact = $2, metrics = metrics || jsonb_build_object('deployment', $3::jsonb) WHERE id = $1`,
      [job.build_id, artifact, JSON.stringify(live)],
    );
    await db.query(
      `UPDATE deployments SET status = 'done', step = 'Live', result = $2, ${ERASE} WHERE id = $1`,
      [job.id, live],
    );
    await emitEvent(db, job.build_id, "deploying", "done", { url: result.url });
  } catch (err) {
    const message = (err instanceof Error ? err.message : "deployment failed").slice(0, 500);
    await db.query(`UPDATE deployments SET status = 'failed', error = $2, ${ERASE} WHERE id = $1`, [
      job.id,
      message,
    ]);
    await emitEvent(db, job.build_id, "deploying", "failed", { error: message });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return true;
}

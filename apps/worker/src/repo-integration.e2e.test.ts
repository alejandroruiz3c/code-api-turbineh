import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  closePool,
  enqueueRepoIntegration,
  getPool,
  listRepoIntegrations,
  migrate,
  saveGithubConnection,
} from "@turbineh/db";
import { github, writeComponentPackage, zipDirectory } from "@turbineh/engine";
import { createLogger, encrypt, loadLocalEnv, readEnv } from "@turbineh/shared";
import { storageFromEnv } from "@turbineh/storage";
import { run, SANDBOX_IMAGE } from "@turbineh/verifier";
import { adaptationCoderFromEnv } from "./models.js";
import { processRepoIntegration } from "./repo-integration.js";

/**
 * Full repository integration against a REAL throwaway GitHub repository (PLAN §16 P5, ADR-0032). Opt-in:
 *   TURBINEH_E2E_GITHUB=1 pnpm --filter @turbineh/worker exec vitest run src/repo-integration.e2e.test.ts
 * Needs GITHUB_TOKEN (create/delete repositories) and DELIVERY_TOKEN_KEY in .env.local, Docker with the sandbox
 * image and a PostgreSQL (E2E_DATABASE_URL, default: infra/docker-compose). Creates a private repository with a
 * small Next.js + Drizzle project, integrates the AI assistant capability, checks the pull request is verified,
 * then deletes the repository (E2E_KEEP_REPO=1 keeps it). Tokens are never printed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
loadLocalEnv(repoRoot);
const ENABLED = process.env.TURBINEH_E2E_GITHUB === "1" && Boolean(process.env.GITHUB_TOKEN);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (["node_modules", ".next", "cache", "logs", "home"].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

/** Lockfile and initial migration of the fixture, produced by its own tools inside the sandbox. */
async function prepareFixture(): Promise<string> {
  const job = mkdtempSync(join(tmpdir(), "tbh-e2e-fixture-"));
  cpSync(join(here, "../fixtures/next-app"), join(job, "repo"), { recursive: true });
  const base = [
    "run",
    "--rm",
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "-e",
    "HOME=/job/home",
    "-v",
    `${job}:/job`,
    "-w",
    "/job/repo",
  ];
  const a = await run("docker", [
    ...base,
    SANDBOX_IMAGE,
    "sh",
    "-c",
    "mkdir -p /job/home && pnpm install --ignore-scripts --store-dir /job/cache/store >/dev/null 2>&1; echo CODE $?",
  ]);
  expect(a.tail).toContain("CODE 0");
  const b = await run("docker", [
    ...base.slice(0, 2),
    "--network",
    "none",
    ...base.slice(2),
    SANDBOX_IMAGE,
    "sh",
    "-c",
    "npx --no-install drizzle-kit generate --name init >/dev/null 2>&1; echo CODE $?",
  ]);
  expect(b.tail).toContain("CODE 0");
  return join(job, "repo");
}

describe.skipIf(!ENABLED)("repository integration on a real GitHub repository", () => {
  it(
    "analyse → adapt → commits → PR → verified in the sandbox → integration_verified",
    async () => {
      const token = process.env.GITHUB_TOKEN ?? "";
      const key = process.env.DELIVERY_TOKEN_KEY ?? "";
      const gh = github(token);
      const me = await gh<{ login: string }>("GET", "/user");
      const name = `turbineh-it-${Date.now().toString(36)}`;
      const repo = `${me?.login}/${name}`;
      const adminUrl =
        process.env.E2E_DATABASE_URL ??
        "postgres://turbineh:turbineh_local_only@127.0.0.1:54329/turbineh";
      const dbName = `turbineh_e2e_${Date.now().toString(36)}`;
      const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
      await admin.query(`CREATE DATABASE ${dbName}`);
      const dbUrl = adminUrl.replace(/\/[^/]*$/, `/${dbName}`);
      let created = false;
      try {
        // 1 · a private repository with a real project on main
        const fixture = await prepareFixture();
        await gh("POST", "/user/repos", { name, private: true, auto_init: true });
        created = true;
        const main = await gh<{ object: { sha: string } }>(
          "GET",
          `/repos/${repo}/git/ref/heads/main`,
        );
        const files = listFiles(fixture);
        const tree = await gh<{ sha: string }>("POST", `/repos/${repo}/git/trees`, {
          tree: files.map((p) => ({
            path: p,
            mode: "100644",
            type: "blob",
            content: readFileSync(join(fixture, p), "utf8"),
          })),
        });
        const commit = await gh<{ sha: string }>("POST", `/repos/${repo}/git/commits`, {
          message: "Acme Notes",
          tree: tree?.sha,
          parents: [main?.object.sha],
        });
        await gh("PATCH", `/repos/${repo}/git/refs/heads/main`, { sha: commit?.sha, force: true });

        // 2 · a generated capability package (the real AI assistant components)
        await migrate(dbUrl);
        const db = getPool(dbUrl);
        process.env.DATABASE_URL ??= dbUrl;
        const env = readEnv();
        const storageDir = mkdtempSync(join(tmpdir(), "tbh-e2e-store-"));
        const storage = storageFromEnv({}, storageDir);
        const out = mkdtempSync(join(tmpdir(), "tbh-e2e-pkg-"));
        const info = {
          slug: "ai-assistant",
          name: "AI assistant",
          need: "An AI assistant that answers from our help centre",
          planId: randomUUID(),
          state: "verified" as const,
          summary: "AI assistant with the TurbineH orchestrator and AI Safety Pack",
          components: [],
          checks: [{ name: "certification", ok: true }],
        };
        const dir = writeComponentPackage(
          ["ai.orchestrator.turbineh", "security.ai-safety.turbineh"].map((id) => ({
            id,
            version: "0.1.0",
            license: "Apache-2.0",
            purl: `pkg:generic/turbineh/${id}@0.1.0`,
            capability: id,
            dir: join(repoRoot, "catalog/components", id),
            does: id,
          })),
          out,
          info,
        );
        const zipKey = `builds/${info.planId}/package/ai-assistant.zip`;
        await storage.put(zipKey, zipDirectory(dir, "ai-assistant"), "application/zip");
        const owner = `invite:e2e-${Date.now().toString(36)}`;
        await db.query(
          `INSERT INTO builds (id, prompt, status, owner_id, options, metrics, artifact, finished_at)
           VALUES ($1, $2, 'done', $3, '{"mode":"generate"}', '{}', $4, now())`,
          [
            info.planId,
            info.need,
            owner,
            JSON.stringify({ package: { zipKey, slug: "ai-assistant" } }),
          ],
        );
        // 3 · the workspace's GitHub connection (encrypted at rest)
        await saveGithubConnection(db, {
          ownerId: owner,
          tokenEnc: encrypt(token, key),
          login: me?.login ?? "",
          scopes: "",
          privateRepos: true,
          via: "token",
        });
        await enqueueRepoIntegration(db, {
          id: `in_e2e${Date.now().toString(36)}`,
          buildId: info.planId,
          ownerId: owner,
          repo,
          base: null,
        });
        // 4 · the job, as the worker runs it
        const worked = await processRepoIntegration({
          db,
          storage,
          tokenKey: key,
          repoRoot,
          workerId: "e2e",
          coder: adaptationCoderFromEnv(env),
          appUrl: null,
          log: createLogger("e2e"),
        });
        expect(worked).toBe(true);
        const [job] = await listRepoIntegrations(db, info.planId, owner);
        const checks = (job?.result.checks ?? []) as {
          name: string;
          ok: boolean | null;
          detail: string;
        }[];
        console.log(
          JSON.stringify(
            {
              repo,
              pr: job?.pr_url,
              status: job?.status,
              state: job?.state,
              draft: job?.draft,
              error: job?.error?.message,
              checks: checks.map(
                (c) => `${c.ok === false ? "FAIL" : "ok"} ${c.name}: ${c.detail.slice(0, 160)}`,
              ),
            },
            null,
            1,
          ),
        );
        expect(job?.status).toBe("done");
        expect(job?.pr_url).toMatch(/\/pull\/\d+$/);
        expect(job?.state).toBe("integration_verified");
        expect(job?.draft).toBe(false);
        const pr = await gh<{ body: string; draft: boolean; title: string }>(
          "GET",
          `/repos/${repo}/pulls/${job?.pr_number}`,
        );
        expect(pr?.body).toContain("Verified inside your project");
        expect(pr?.title.startsWith("[Draft]")).toBe(false);
      } finally {
        if (created && process.env.E2E_KEEP_REPO !== "1")
          await gh("DELETE", `/repos/${repo}`).catch(() => undefined);
        await closePool();
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
        await admin.end();
      }
    },
    60 * 60_000,
  );
});

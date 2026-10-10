import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { emitEvent, setRepoUrl } from "@turbineh/db";
import { decrypt } from "@turbineh/shared";
import type { ArtifactStorage } from "@turbineh/storage";

interface DeliveryRow {
  id: string;
  build_id: string;
  repo_name: string;
  token_enc: string;
  artifact: { bundleKey?: string; slug?: string } | null;
  prompt: string;
}

const GH = "https://api.github.com";

async function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${GH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "code-api-turbineh",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
    // Respect GitHub rate limits (PLAN §7.1): retry-after / x-ratelimit-reset with backoff.
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
    ) {
      const wait = Number(res.headers.get("retry-after") ?? 2 ** attempt * 5);
      await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000));
      continue;
    }
    return res;
  }
  throw new Error("GitHub rate limit: giving up");
}

/** Claims one queued delivery and pushes the build to the user's GitHub account with a single git push. */
export async function processDelivery(
  db: pg.Pool,
  storage: ArtifactStorage,
  tokenKey: string,
): Promise<boolean> {
  const claimed = await db.query<DeliveryRow>(
    `UPDATE deliveries d SET status = 'running'
     FROM builds b
     WHERE d.id = (SELECT id FROM deliveries WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       AND b.id = d.build_id
     RETURNING d.id, d.build_id, d.repo_name, d.token_enc, b.artifact, b.prompt`,
  );
  const job = claimed.rows[0];
  if (!job) return false;
  const work = mkdtempSync(join(tmpdir(), "turbineh-deliver-"));
  try {
    const token = decrypt(job.token_enc, tokenKey);
    const me = (await (await gh(token, "/user")).json()) as { login: string };
    let name = job.repo_name;
    let create = await gh(token, "/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        private: true,
        description: `Built with CODE-API-TURBINEH: ${job.prompt.slice(0, 200)}`,
        auto_init: false,
      }),
    });
    if (create.status === 422) {
      name = `${job.repo_name}-${job.build_id.slice(0, 8)}`;
      create = await gh(token, "/user/repos", {
        method: "POST",
        body: JSON.stringify({ name, private: true, auto_init: false }),
      });
    }
    if (!create.ok) throw new Error(`could not create repository (${create.status})`);
    const repo = (await create.json()) as { html_url: string; clone_url: string };

    if (!job.artifact?.bundleKey) throw new Error("artifact bundle missing");
    const bundle = join(work, "app.bundle");
    writeFileSync(bundle, await storage.get(job.artifact.bundleKey));
    execFileSync("git", ["clone", "--quiet", "--bare", bundle, join(work, "repo.git")], {
      stdio: "pipe",
    });
    // One push of the whole history; the token only lives in this child's environment.
    execFileSync(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!f() { echo username=x-access-token; echo password=$DELIVERY_TOKEN; }; f",
        "push",
        "--quiet",
        "--mirror",
        repo.clone_url,
      ],
      {
        cwd: join(work, "repo.git"),
        env: { ...process.env, DELIVERY_TOKEN: token, GIT_TERMINAL_PROMPT: "0" },
        stdio: "pipe",
      },
    );
    await db.query(
      "UPDATE deliveries SET status = 'done', repo_url = $2, token_enc = NULL, finished_at = now() WHERE id = $1",
      [job.id, repo.html_url],
    );
    await setRepoUrl(db, job.build_id, repo.html_url);
    await emitEvent(db, job.build_id, "delivering", "github", {
      channel: "B",
      repo_url: repo.html_url,
      owner: me.login,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message.replace(/gh[opsu]_[A-Za-z0-9]+/g, "[redacted]")
        : "delivery failed";
    await db.query(
      "UPDATE deliveries SET status = 'failed', error = $2, token_enc = NULL, finished_at = now() WHERE id = $1",
      [job.id, message.slice(0, 500)],
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return true;
}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNeonDatabase } from "./neon.js";
import { Vercel, VercelError } from "./vercel.js";

export interface DeployInput {
  repoDir: string;
  slug: string;
  buildId: string;
  vercel: { token: string; teamId?: string };
  database: { mode: "neon"; apiKey: string } | { mode: "url"; url: string };
  adminEmail?: string;
  onStep: (step: string) => Promise<void>;
}

export interface DeployResult {
  url: string;
  vercelProject: string;
  database: {
    provider: "neon" | "external";
    projectId?: string | undefined;
    region?: string | undefined;
  };
  settings: string[];
  cron: boolean;
  deploymentId: string;
}

const KEYS_IN = (envExample: string) =>
  envExample
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1])
    .filter((k): k is string => Boolean(k));

const secret = () => randomBytes(36).toString("base64url");

/** Non-empty SHOP_* settings of .env.example (explicit allow-list: other defaults are local values like localhost). */
export function shopSettings(envExample: string): [string, string][] {
  return envExample
    .split("\n")
    .map((l) => /^(SHOP_[A-Z0-9_]+)=([a-z0-9,._-]+)\s*$/i.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m?.[1] && m[2]))
    .map((m) => [m[1] ?? "", m[2] ?? ""]);
}

/** vercel.json for the client's project: EU functions next to the EU database; daily job runner when present. */
export function vercelConfig(cron: boolean): Record<string, unknown> {
  return {
    regions: ["fra1"],
    ...(cron ? { crons: [{ path: "/api/jobs/run", schedule: "0 6 * * *" }] } : {}),
  };
}

export async function deployToClient(input: DeployInput): Promise<DeployResult> {
  const vercel = new Vercel(input.vercel.token, input.vercel.teamId);
  await input.onStep("Checking your Vercel access");
  await vercel.user();

  const keys = KEYS_IN(readFileSync(join(input.repoDir, ".env.example"), "utf8"));
  const cron = keys.includes("JOBS_RUNNER_SECRET");
  // Checked before anything is created in the client's accounts.
  if (keys.includes("ADMIN_EMAILS") && !input.adminEmail) {
    throw new Error("this app has an admin panel: please give the admin email and try again");
  }

  await input.onStep(
    input.database.mode === "neon" ? "Creating your database (Neon, EU)" : "Using your database",
  );
  const db =
    input.database.mode === "neon"
      ? await createNeonDatabase(input.database.apiKey, input.slug)
      : { connectionUri: input.database.url, projectId: undefined, region: undefined };

  await input.onStep("Creating your Vercel project");
  let project: { id: string; name: string };
  try {
    project = await vercel.createProject(input.slug.slice(0, 90));
  } catch (err) {
    if (!(err instanceof VercelError) || err.status !== 409) throw err;
    project = await vercel.createProject(`${input.slug.slice(0, 80)}-${input.buildId.slice(0, 6)}`);
  }
  let url = `https://${project.name}.vercel.app`;

  await input.onStep("Configuring settings and secrets");
  const env: { key: string; value: string; sensitive: boolean }[] = [
    { key: "DATABASE_URL", value: db.connectionUri, sensitive: true },
    { key: "BETTER_AUTH_SECRET", value: secret(), sensitive: true },
    { key: "BETTER_AUTH_URL", value: url, sensitive: false },
  ];
  if (keys.includes("ADMIN_EMAILS") && input.adminEmail) {
    env.push({ key: "ADMIN_EMAILS", value: input.adminEmail, sensitive: false });
  }
  // Shop configuration chosen at build time (currencies from the request, tax mode): plain settings, never secrets.
  for (const [key, value] of shopSettings(
    readFileSync(join(input.repoDir, ".env.example"), "utf8"),
  )) {
    env.push({ key, value, sensitive: false });
  }
  if (cron) {
    const s = secret();
    env.push(
      { key: "JOBS_RUNNER_SECRET", value: s, sensitive: true },
      { key: "CRON_SECRET", value: s, sensitive: true },
    );
  }
  await vercel.setEnv(project.id, env);

  await input.onStep("Uploading your app");
  writeFileSync(
    join(input.repoDir, "vercel.json"),
    `${JSON.stringify(vercelConfig(cron), null, 2)}\n`,
  );
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: input.repoDir,
  })
    .toString()
    .split("\n")
    .filter((f) => f && existsSync(join(input.repoDir, f)));
  const uploaded: { file: string; sha: string; size: number }[] = [];
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map(async (file) => {
        const bytes = readFileSync(join(input.repoDir, file));
        uploaded.push({ file, sha: await vercel.uploadFile(bytes), size: bytes.length });
      }),
    );
  }

  await input.onStep("Building and going live (migrations run inside your build)");
  let deployment = await vercel.deploy(project.name, uploaded);
  const state = await waitReady(vercel, deployment.id);
  const alias = state.alias?.find((a) => a.endsWith(".vercel.app"));
  if (alias && `https://${alias}` !== url) {
    // The public address differs from the guess: fix BETTER_AUTH_URL and deploy once more.
    url = `https://${alias}`;
    await vercel.setEnv(project.id, [{ key: "BETTER_AUTH_URL", value: url, sensitive: false }]);
    deployment = await vercel.deploy(project.name, uploaded);
    await waitReady(vercel, deployment.id);
  }

  await input.onStep("Checking that your app responds");
  for (const path of ["/", "/sign-in"]) {
    const res = await fetchWithRetry(`${url}${path}`);
    if (res.status >= 400) throw new Error(`the live app answered ${res.status} on ${path}`);
  }
  return {
    url,
    vercelProject: project.name,
    database:
      input.database.mode === "neon"
        ? { provider: "neon", projectId: db.projectId, region: db.region }
        : { provider: "external" },
    settings: env.map((e) => e.key),
    cron,
    deploymentId: deployment.id,
  };
}

async function waitReady(vercel: Vercel, id: string) {
  for (let i = 0; i < 180; i++) {
    const d = await vercel.deployment(id);
    if (d.readyState === "READY") return d;
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
      throw new Error(
        `the build failed on Vercel${d.errorMessage ? `: ${d.errorMessage.slice(0, 200)}` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("the build took longer than 15 minutes");
}

async function fetchWithRetry(url: string): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < 6; i++) {
    last = await fetch(url, { redirect: "manual" }).catch(() => null);
    if (last && last.status < 500) return last;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last ?? new Response(null, { status: 599 });
}

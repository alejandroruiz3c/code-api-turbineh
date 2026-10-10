import { spawn } from "node:child_process";

export const SANDBOX_IMAGE = "turbineh/sandbox:1";
export const PNPM_STORE_VOLUME = "turbineh-pnpm-store";
export const POSTGRES_IMAGE =
  "pgvector/pgvector:0.8.6-pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f";

/** Synthetic configuration only: real secrets never enter a sandbox (PLAN §1.6). */
export const SYNTHETIC_ENV = {
  BETTER_AUTH_SECRET: "sandbox-synthetic-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  ADMIN_EMAILS: "admin-e2e@example.com",
};

export interface RunResult {
  code: number;
  ms: number;
  tail: string;
}

export function run(cmd: string, args: string[], timeoutMs = 15 * 60_000): Promise<RunResult> {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-8000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        ms: Math.round(performance.now() - start),
        tail: out.slice(-3000),
      });
    });
  });
}

/** Runs a shell script inside a fresh sandbox container. */
export function sandbox(
  workDir: string,
  script: string,
  opts: { network: "none" | string; env: Record<string, string> },
): Promise<RunResult> {
  const envArgs = Object.entries(opts.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return run("docker", [
    "run",
    "--rm",
    "--network",
    opts.network,
    "--memory",
    process.env.SANDBOX_MEMORY ?? "6g",
    "--cpus",
    process.env.SANDBOX_CPUS ?? "4",
    "--pids-limit",
    "2048",
    "--security-opt",
    "no-new-privileges",
    "-v",
    `${PNPM_STORE_VOLUME}:/pnpm-store`,
    "-v",
    `${workDir}:/work`,
    ...envArgs,
    SANDBOX_IMAGE,
    "sh",
    "-c",
    script,
  ]);
}

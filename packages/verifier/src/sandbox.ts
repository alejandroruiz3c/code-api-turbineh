import { spawn } from "node:child_process";

export const SANDBOX_IMAGE = "turbineh/sandbox:1";
export const PNPM_STORE_VOLUME = "turbineh-pnpm-store";
export const POSTGRES_IMAGE =
  "pgvector/pgvector:0.8.6-pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f";

/** Synthetic configuration only: real secrets never enter a sandbox (PLAN §1.6). */
/** Official Stripe API simulator (MIT), used only inside the isolated verification network of shop apps. */
export const STRIPE_MOCK_IMAGE =
  "stripe/stripe-mock:v0.205.0@sha256:ff32647993847be491e68533e2881c90434fa8d5df40246ee5f7d41253422081";

/** Synthetic Stripe settings for verification (never real keys; the simulator accepts any test key). */
export const STRIPE_SYNTHETIC = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_sandbox_synthetic_0123456789abcdef",
  STRIPE_PRICE_PRO: "price_123",
};

/**
 * Synthetic AI settings for apps that use the orchestrator (ADR-0028): every model and decider call goes to the
 * deterministic simulator (services/ai-mock) on the isolated network. Never real keys.
 */
export const aiSynthetic = (host: string) => ({
  // Same layout as the TurbineH AI gateway: <root>/v1/chat/completions, /v1/embeddings, /v1/systemone.
  TURBINEH_AI_URL: `http://${host}:8080`,
  TURBINEH_AI_TOKEN: "sandbox-synthetic-ai-token",
});

/**
 * Only what every app documents as required (src/env.ts). Allow-lists such as ADMIN_EMAILS are deliberately absent:
 * build and unit tests must pass without them and E2E sets its own (playwright.config.ts). BETTER_AUTH_URL is an
 * ambient value on another host and port on purpose: E2E must ignore it and use the server it starts.
 */
export const SYNTHETIC_ENV = {
  BETTER_AUTH_SECRET: "sandbox-synthetic-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
};

/**
 * Variables `src/env.ts` requires: declared in the schema without `.optional()` or `.default(` (NODE_ENV aside).
 * Build and unit tests run with only these, so an app never needs an optional setting to build or test.
 */
export function requiredEnv(envTs: string): string[] {
  const keys = [...envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)];
  return keys
    .filter((k, i) => {
      const chunk = envTs.slice(k.index, keys[i + 1]?.index ?? envTs.length);
      return !/\.optional\(\)|\.default\(/.test(chunk) && k[1] !== "NODE_ENV";
    })
    .map((k) => k[1] as string);
}

export interface RunResult {
  code: number;
  ms: number;
  tail: string;
}

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 15 * 60_000,
  fullOutput = false,
  /** Called with every complete output line as it arrives (live progress, e.g. `PROGRESS` markers). */
  onLine?: (line: string) => void,
): Promise<RunResult> {
  const start = performance.now();
  return new Promise((resolve) => {
    // Own process group: a graceful worker stop (SIGTERM to the worker) must not reach docker clients, which would
    // forward it to the sandbox container and break a verification in progress.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    const partial = { stdout: "", stderr: "" };
    const lines = (key: "stdout" | "stderr", d: Buffer) => {
      if (!onLine) return;
      const parts = (partial[key] + d.toString()).split("\n");
      partial[key] = parts.pop() ?? "";
      for (const l of parts) {
        try {
          onLine(l);
        } catch {
          // progress reporting never breaks a run
        }
      }
    };
    const keep = (d: Buffer) => {
      out = fullOutput ? out + d.toString() : (out + d.toString()).slice(-12000);
    };
    child.stdout.on("data", (d: Buffer) => {
      keep(d);
      lines("stdout", d);
    });
    child.stderr.on("data", (d: Buffer) => {
      keep(d);
      lines("stderr", d);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        ms: Math.round(performance.now() - start),
        tail: fullOutput ? out : out.slice(-6000),
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

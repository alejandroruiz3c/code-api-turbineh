import { spawn } from "node:child_process";
import { api, sleep } from "./api.js";
import { ensureProject, fail } from "./context.js";
import type { Ctx } from "./commands.js";
import { bold, dim, green, red, yellow, type CommandResult } from "./output.js";
import { git, isGitRepo } from "./project.js";

/**
 * GitHub for the CLI (PLAN §16 P5, ADR-0034): `connect github` opens the product's OAuth flow in a browser for this
 * project's workspace (or stores a token read from stdin), `disconnect github` deletes and revokes it, and
 * `apply --pr` integrates the plan into a repository as a verified pull request. Tokens are never printed.
 */

interface Connection {
  connected: boolean;
  login?: string;
  private_repos?: boolean;
  via?: string;
}

interface Integration {
  id: string;
  repo: string;
  status: string;
  phase: string;
  state: string | null;
  branch: string | null;
  pull_request: { url: string; number: number; draft: boolean | null } | null;
  result: {
    checks?: { name: string; ok: boolean | null; detail: string; action?: string }[];
    reviewerSetup?: string[];
    limits?: string[];
  };
  error: { code: string; message: string; action: string; resume?: string } | null;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // The URL is printed anyway.
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function connect(c: Ctx): Promise<CommandResult> {
  if ((c.args[0] ?? "github") !== "github")
    fail("usage", "Only GitHub can be connected.", "Run `turbineh connect github`.");
  const ws = ensureProject(c.cwd).workspace;
  if (c.flags["with-token"] === true) {
    if (process.stdin.isTTY)
      fail(
        "usage",
        "Pipe the token on stdin (never as an argument, so it stays out of your shell history).",
        "Run `gh auth token | turbineh connect github --with-token` or `turbineh connect github --with-token < token.txt`.",
      );
    const token = await readStdin();
    const r = await api<Connection>("/v1/github/token", {
      method: "POST",
      workspace: ws,
      body: { token },
    });
    return {
      ok: true,
      command: "connect",
      state: "connected",
      data: r,
      lines: [
        `${green("✔")} GitHub connected as ${bold(r.login ?? "?")} (token, stored encrypted).`,
      ],
      next: "turbineh apply <plan> --pr --repo owner/name",
    };
  }
  const priv = c.flags.private === true;
  const t = await api<{ url: string; code: string; expires_in: number }>("/v1/github/connect", {
    method: "POST",
    workspace: ws,
    body: { private: priv },
  });
  if (!c.json) {
    process.stderr.write(
      [
        `Open this link to connect GitHub (${priv ? "public and private repositories: GitHub scope repo" : "public repositories: GitHub scope public_repo"}):`,
        `  ${t.url}`,
        `Check that the page shows the code ${bold(t.code)}.`,
        dim("Waiting for the connection (10 minutes)…"),
        "",
      ].join("\n"),
    );
    if (c.flags.open !== false) openBrowser(t.url);
  }
  const until = Date.now() + t.expires_in * 1000;
  while (Date.now() < until) {
    await sleep(Number(process.env.TURBINEH_POLL_MS ?? 3000));
    const s = await api<Connection>("/v1/github", { workspace: ws });
    if (s.connected)
      return {
        ok: true,
        command: "connect",
        state: "connected",
        data: s,
        lines: [
          `${green("✔")} GitHub connected as ${bold(s.login ?? "?")}${s.private_repos ? " (private repositories too)" : " (public repositories)"}.`,
        ],
        next: "turbineh apply <plan> --pr --repo owner/name",
      };
  }
  return fail(
    "timeout",
    "GitHub was not connected within 10 minutes.",
    "Run `turbineh connect github` again and open the new link.",
    "turbineh connect github",
  );
}

export async function disconnect(c: Ctx): Promise<CommandResult> {
  const ws = ensureProject(c.cwd).workspace;
  const r = await api<{ removed: boolean; revoked_at_github: boolean; note?: string }>(
    "/v1/github",
    { method: "DELETE", workspace: ws },
  );
  return {
    ok: true,
    command: "disconnect",
    state: "disconnected",
    data: r,
    lines: [
      r.removed ? `${green("✔")} GitHub disconnected.` : "GitHub was not connected.",
      ...(r.revoked_at_github ? ["The authorization was revoked at GitHub too."] : []),
      ...(r.note ? [r.note] : []),
    ],
  };
}

/** owner/name from the project's `origin` remote on github.com, if any. */
export function originRepo(cwd: string): string | null {
  if (!isGitRepo(cwd)) return null;
  try {
    const url = git(cwd, "remote", "get-url", "origin");
    return /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(url.trim())?.[1] ?? null;
  } catch {
    return null;
  }
}

const PHASE: Record<string, string> = {
  queued: "queued",
  analysing: "analysing your repository",
  adapting: "adapting the package to your conventions",
  preparing: "updating the lockfile and generating the migration (sandbox)",
  committing: "committing step by step and opening the pull request",
  verifying: "verifying inside your project (sandbox)",
};

/** `turbineh apply <plan> --pr`: the verified package as a pull request on a connected repository. */
export async function applyPullRequest(
  c: Ctx,
  planId: string,
  ws: string | undefined,
): Promise<CommandResult> {
  const repo = typeof c.flags.repo === "string" ? c.flags.repo : originRepo(c.cwd);
  const started = await api<{ integration: Integration }>(`/v1/plans/${planId}/pull-request`, {
    method: "POST",
    workspace: ws,
    body: {
      ...(repo ? { repo } : {}),
      ...(typeof c.flags.base === "string" ? { base: c.flags.base } : {}),
    },
  });
  const id = started.integration.id;
  let last = "";
  for (const until = Date.now() + 60 * 60_000; Date.now() < until;) {
    const list = await api<{ integrations: Integration[] }>(`/v1/plans/${planId}/pull-request`, {
      workspace: ws,
    });
    const job = list.integrations.find((x) => x.id === id);
    if (!job) break;
    if (!c.json && job.phase !== last) {
      process.stderr.write(`${dim(`… ${PHASE[job.phase] ?? job.phase}`)}\n`);
      last = job.phase;
    }
    if (job.status === "failed")
      return {
        ok: false,
        command: "apply",
        state: "failed",
        data: job,
        ...(job.error ? { error: job.error } : {}),
      };
    if (job.status === "done") {
      const verified = job.state === "integration_verified";
      const checks = job.result.checks ?? [];
      return {
        ok: verified,
        command: "apply",
        state: job.state ?? "integrated",
        data: job,
        ...(verified || !job.error ? {} : { error: job.error }),
        lines: [
          verified
            ? `${green("✔")} Pull request verified inside your project and ready for review: ${job.pull_request?.url}`
            : `${yellow("!")} Pull request opened as a draft (not verified yet): ${job.pull_request?.url}`,
          ...checks.map(
            (k) =>
              `  ${k.ok === false ? red("✖") : k.ok === null ? dim("–") : green("✓")} ${k.name}${k.ok === false ? ` — ${k.detail}${k.action ? `\n      → ${k.action}` : ""}` : ""}`,
          ),
          ...(job.result.reviewerSetup?.length
            ? ["", bold("What you configure:"), ...job.result.reviewerSetup.map((s) => `  - ${s}`)]
            : []),
        ],
        next: verified
          ? "Review and merge the pull request yourself."
          : "Fix the failures listed (also in the pull request), then run the same command again.",
      };
    }
    await sleep(Number(process.env.TURBINEH_POLL_MS ?? 5000));
  }
  return fail(
    "timeout",
    "The integration is still running.",
    "Check later with `turbineh status`.",
    `turbineh status ${planId}`,
  );
}

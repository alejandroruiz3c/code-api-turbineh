import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "@turbineh/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply, plan, revert, verify, type Ctx } from "./commands.js";
import { CliError } from "./context.js";
import { parse } from "./index.js";
import { print } from "./output.js";
import { appendEnvExample, extractPackage, mergeDependencies } from "./project.js";

const PLAN = {
  id: "11111111-2222-3333-4444-555555555555",
  need: "AI booking agent",
  state: "planned",
  stack: {
    language: "typescript",
    framework: "nextjs",
    packageManager: "pnpm",
    versions: {},
    source: "files",
    adaptationPending: false,
  },
  capability: {
    id: "ai-agents",
    kind: "use_case",
    name: "AI Agents",
    summary: "s",
    components: 2,
    stacks: [],
    requirements: [],
    example: "e",
  },
  components: [
    { id: "ai.orchestrator.turbineh", version: "1.0.0", license: "Apache-2.0", why: "Required" },
  ],
  compatible: true,
  incompatibilities: [],
  missing: [],
  decisions: [],
  files: [{ path: "turbineh/booking-agent/README.md", action: "add", why: "Start here" }],
  dependencies: [{ name: "zod", version: "4.6.5" }],
  config: [{ kind: "env", name: "TURBINEH_AI_TOKEN", why: "AI", satisfied: false }],
  estimate: { seconds: 162, costUsd: 0.004, tokens: 10000, newLinesToMaintain: 30 },
  needsApproval: [],
};

function fakeApi() {
  let state = "planning";
  const calls: string[] = [];
  const zip = createZip([
    {
      path: "booking-agent/manifest.json",
      data: Buffer.from(
        JSON.stringify({
          slug: "booking-agent",
          dependencies: { zod: "4.6.5", "left-pad": "1.3.0" },
          environment: ["DATABASE_URL", "TURBINEH_AI_TOKEN"],
          state: "verified",
        }),
      ),
    },
    {
      path: "booking-agent/src/lib/ai/orchestrator.ts",
      data: Buffer.from("export const orchestrate = 1;\n"),
    },
    { path: "booking-agent/agent/INTEGRATE.md", data: Buffer.from("# INTEGRATE\n") },
  ]);
  const result = (s: string) => ({
    planId: PLAN.id,
    state: s,
    works: [],
    needs: [],
    checks: [],
    package: { zipUrl: null, manifestUrl: null },
    try: null,
    continue: "",
    revert: "",
    agentInstructions:
      "Integrate this package into the project following turbineh/booking-agent/agent/INTEGRATE.md.",
    metrics: { seconds: 0, tokens: 0, reusedShare: 0, securityFindings: 0, newLines: 0 },
    errors: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      calls.push(`${init.method ?? "GET"} ${path}`);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (path === "/v1/plans" && init.method === "POST")
        return json({ id: PLAN.id, stack: PLAN.stack }, 202);
      if (path.endsWith("/generate")) {
        state = "generating";
        return json({ state }, 202);
      }
      if (path.endsWith("/package")) return new Response(zip);
      if (path.endsWith("/integrations")) return json({ integration: {} }, 201);
      if (path === `/v1/plans/${PLAN.id}`) {
        const now = state;
        state = state === "planning" ? "planned" : state === "generating" ? "verified" : state;
        return json({
          id: PLAN.id,
          need: PLAN.need,
          state: now,
          plan: { ...PLAN, state: now },
          result: result(now),
        });
      }
      return json({ error: { code: "not_found", message: "nope", action: "x" } }, 404);
    }),
  );
  return calls;
}

let cwd: string;
const ctx = (args: string[], flags: Record<string, string | boolean> = {}): Ctx => ({
  cwd,
  args,
  flags: { yes: true, ...flags },
  json: true,
  confirm: async () => true,
});

beforeEach(() => {
  process.env.TURBINEH_TOKEN = "FRONTIERS_TEST";
  process.env.TURBINEH_POLL_MS = "1";
  process.env.TURBINEH_URL = "https://example.test";
  cwd = mkdtempSync(join(tmpdir(), "proj-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ dependencies: { next: "16.3.8", zod: "4.6.5" } }),
  );
  writeFileSync(join(cwd, "tsconfig.json"), "{}");
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"],
    { cwd },
  );
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "app"], {
    cwd,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("turbineh CLI", () => {
  it("parses commands and flags", () => {
    expect(parse(["plan", "AI", "agent", "--json", "--stack", "nextjs", "--no-wait"])).toEqual({
      cmd: "plan",
      args: ["AI", "agent"],
      flags: { json: true, stack: "nextjs", wait: false },
    });
  });

  it("plan → apply → verify → revert, keeping later work and reporting each state", async () => {
    const calls = fakeApi();
    const p = await plan(ctx(["AI", "booking", "agent"]));
    expect(p).toMatchObject({ ok: true, state: "planned" });
    expect(calls[0]).toBe("POST /v1/plans");

    const a = await apply(ctx([]));
    expect(a).toMatchObject({ ok: true, state: "integrated" });
    expect(existsSync(join(cwd, "turbineh/booking-agent/agent/INTEGRATE.md"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["left-pad"]).toBe("1.3.0");
    expect(readFileSync(join(cwd, ".env.example"), "utf8")).toMatch(/TURBINEH_AI_TOKEN=/);
    expect(execFileSync("git", ["branch", "--show-current"], { cwd }).toString().trim()).toMatch(
      /^turbineh\/booking-agent-/,
    );
    expect(calls).toContain(`POST /v1/plans/${PLAN.id}/generate`);

    const v = await verify(ctx([], { "skip-scripts": true }));
    expect(v.ok).toBe(false);
    expect(v.error?.code).toBe("check_failed_dependencies_installed");
    expect(v.error?.action).toBeTruthy();
    expect(v.error?.resume).toMatch(/turbineh verify in_/);

    writeFileSync(join(cwd, "later.txt"), "my later work\n");
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "later"],
      { cwd },
    );
    const r = await revert(ctx([]));
    expect(r.ok).toBe(true);
    expect(existsSync(join(cwd, "turbineh/booking-agent"))).toBe(false);
    expect(existsSync(join(cwd, "later.txt"))).toBe(true);
  });

  it("refuses to apply over uncommitted work with an actionable error", async () => {
    fakeApi();
    await plan(ctx(["AI", "booking", "agent"]));
    writeFileSync(join(cwd, "dirty.txt"), "x");
    await expect(apply(ctx([]))).rejects.toMatchObject({ error: { code: "dirty_tree" } });
    await expect(apply(ctx([]))).rejects.toBeInstanceOf(CliError);
  });

  it("human and JSON output express the same state and error", () => {
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((s) => (out.push(String(s)), true));
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s) => (out.push(String(s)), true));
    const r = {
      ok: false,
      command: "verify",
      state: "integrated",
      error: {
        code: "missing_env",
        message: "TURBINEH_AI_TOKEN is not set.",
        action: "Set it in .env.local",
        resume: "turbineh verify in_x",
      },
    };
    print(r, true);
    const json = JSON.parse(out.join("")) as typeof r;
    out.length = 0;
    print(r, false);
    const human = out.join("");
    spy.mockRestore();
    err.mockRestore();
    expect(json).toMatchObject(r);
    expect(human).toContain("TURBINEH_AI_TOKEN is not set.");
    expect(human).toContain("Set it in .env.local");
    expect(human).toContain("turbineh verify in_x");
  });

  it("never writes outside the package folder and never writes values", () => {
    expect(() =>
      extractPackage(cwd, createZip([{ path: "x/../../etc", data: Buffer.from("") }]), "x"),
    ).toThrow();
    expect(mergeDependencies(cwd, { zod: "9.9.9" }).kept).toEqual(["zod"]);
    expect(appendEnvExample(cwd, ["A_KEY"], "cap")).toEqual(["A_KEY"]);
    expect(readFileSync(join(cwd, ".env.example"), "utf8")).toMatch(/^A_KEY=$/m);
  });
});

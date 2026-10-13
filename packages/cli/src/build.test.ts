import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "@turbineh/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_BLOCK, skillMarkdown, upsertBlock, writeAgentFiles } from "./agent-docs.js";
import { build, EXIT, readSpec, targetOf, writeAppFiles } from "./build.js";
import type { Ctx } from "./commands.js";
import { readProject } from "./context.js";
import { runCommand } from "./registry.js";

const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const PLAN = {
  id: ID,
  need: "shop",
  state: "planned",
  stack: {
    language: "unknown",
    versions: {},
    source: "none",
    adaptationPending: false,
  },
  capability: {
    id: "storefront",
    kind: "use_case",
    name: "Storefront",
    summary: "s",
    components: 2,
    stacks: [],
    requirements: [],
    example: "e",
  },
  components: [{ id: "payments.stripe", version: "1.0.0", license: "MIT", why: "Payments" }],
  compatible: true,
  incompatibilities: [],
  missing: [],
  decisions: [],
  files: [],
  dependencies: [],
  config: [{ kind: "env", name: "STRIPE_SECRET_KEY", why: "Payments", satisfied: false }],
  estimate: { seconds: 180, costUsd: 0.02, tokens: 3000, newLinesToMaintain: 0 },
  needsApproval: [] as string[],
  criteria: [
    { criterion: "Shoppers pay with Stripe Checkout", status: "covered", tests: ["shop.spec.ts"] },
    { criterion: "Admin sees stock changes", status: "open", tests: [] },
  ],
};

const GUIDE = {
  schema: "turbineh.package/v1",
  buildId: ID,
  app: { name: "Northwind Coffee", summary: "s" },
  status: "verified",
  left: [
    {
      kind: "criterion",
      what: "Admin sees stock changes",
      where: "src/app/admin, tests/e2e/app.spec.ts",
      how: "Implement and prove it",
    },
  ],
  criteria: [
    {
      text: "Shoppers pay with Stripe Checkout",
      status: "met",
      test: { file: "tests/e2e/shop.spec.ts", title: "pays" },
    },
    { text: "Admin sees stock changes", status: "open" },
  ],
  gate: { ok: true, verifiedAt: "2026-10-12", steps: [], findings: [] },
  env: { required: [{ name: "DATABASE_URL" }, { name: "STRIPE_SECRET_KEY" }] },
  rerun: [],
};

const f = (path: string, text: string) => ({ path: `northwind/${path}`, data: Buffer.from(text) });
const APP_ZIP = createZip([
  f("package.json", JSON.stringify({ name: "northwind", scripts: { build: "next build" } })),
  f("CLAUDE.md", "@AGENTS.md\n"),
  f("AGENTS.md", "# Northwind — agent guide\n"),
  f("README.md", "# Northwind\n"),
  f(".gitignore", "node_modules/\n.env*\n!.env.example\n"),
  f("turbineh.json", JSON.stringify(GUIDE)),
  f("src/app/page.tsx", "export default function P() { return null; }\n"),
  f("scripts/local-db.ts", "export {};\n"),
]);

const c = (s: string) => ({ path: `notes/${s}`, data: Buffer.from("") });
const CAP_ZIP = createZip([
  {
    path: "notes/manifest.json",
    data: Buffer.from(
      JSON.stringify({
        slug: "notes",
        name: "Notes",
        dependencies: { zod: "4.6.5" },
        environment: ["NOTES_API_KEY"],
      }),
    ),
  },
  {
    path: "notes/src/lib/notes.ts",
    data: Buffer.from('import { z } from "zod";\nexport const notes = z.string();\n'),
  },
  {
    path: "notes/tests/unit/notes.test.ts",
    data: Buffer.from('import { notes } from "../../src/lib/notes";\nexport { notes };\n'),
  },
  { ...c("agent/INTEGRATE.md"), data: Buffer.from("# Integrate\n") },
  { ...c("config/.env.example"), data: Buffer.from("# Notes service key\nNOTES_API_KEY=\n") },
]);

let states: string[] = [];
let calls: string[] = [];
let needsApproval: string[] = [];

function fakeApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const path = u.pathname;
      calls.push(`${init.method ?? "GET"} ${path}${u.search}`);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (path === "/v1/plans" && init.method === "POST") return json({ id: ID }, 202);
      if (path.endsWith("/generate")) {
        states = ["generating", "verified"];
        return json({ state: "generating" }, 202);
      }
      if (path.endsWith("/package"))
        return new Response(u.searchParams.get("format") === "app" ? APP_ZIP : CAP_ZIP);
      if (path.endsWith("/integrations")) return json({}, 201);
      if (path === `/v1/plans/${ID}`) {
        const state = states.length > 1 ? (states.shift() as string) : (states[0] ?? "planning");
        const plan = state === "planning" ? null : { ...PLAN, needsApproval };
        return json({
          id: ID,
          need: "shop",
          state,
          plan,
          result: {
            planId: ID,
            state,
            works: [],
            needs: [],
            checks:
              state === "verified" || state === "generated"
                ? [
                    { name: "lint", ok: true },
                    { name: "e2e", ok: state === "verified" },
                  ]
                : [],
            package: { zipUrl: null, manifestUrl: null },
            try: null,
            continue: "",
            revert: "",
            agentInstructions: "",
            metrics: { seconds: 0, tokens: 0, reusedShare: 0, securityFindings: 0, newLines: 0 },
            errors:
              state === "failed"
                ? [{ code: "generation_failed", message: "no", action: "rephrase" }]
                : [],
          },
        });
      }
      return json({ error: { code: "not_found", message: "nope", action: "x" } }, 404);
    }),
  );
}

let cwd: string;
let events: Record<string, unknown>[];
const ctx = (args: string[], flags: Record<string, string | boolean> = {}): Ctx => ({
  cwd,
  args,
  flags,
  json: true,
  confirm: async () => false,
  emit: (e) => events.push(e),
});

beforeEach(() => {
  process.env.TURBINEH_TOKEN = "FRONTIERS_TEST";
  process.env.TURBINEH_POLL_MS = "1";
  process.env.TURBINEH_URL = "https://example.test";
  // No git identity anywhere: the commit must still succeed (fallback identity).
  const home = mkdtempSync(join(tmpdir(), "home-"));
  writeFileSync(join(home, "gitconfig"), "[init]\n\tdefaultBranch = main\n");
  process.env.GIT_CONFIG_GLOBAL = join(home, "gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;
  delete process.env.EMAIL;
  cwd = mkdtempSync(join(tmpdir(), "build-"));
  events = [];
  needsApproval = [];
  states = ["planning", "planned", "generating", "verified"];
  fakeApi();
});
afterEach(() => vi.unstubAllGlobals());

const git = (...a: string[]) => execFileSync("git", a, { cwd }).toString().trim();

describe("turbineh build — empty folder → complete application", () => {
  it("plans, waits, writes, commits with a fallback identity and summarises criteria and settings", async () => {
    writeAgentFiles(cwd, "claude", "https://example.test");
    writeFileSync(join(cwd, "spec.md"), "# Shop\n\n> Build a simple online shop with Stripe.\n");
    expect(targetOf(cwd)).toBe("app");

    const r = await build(ctx(["@spec.md"]));
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(EXIT.ok);
    // The plan_ready event comes before anything is written, with the criteria nothing will prove yet.
    expect(events.map((e) => e.event)).toEqual(["started", "plan_ready"]);
    expect(events[1]).toMatchObject({
      criteria: {
        covered: ["Shoppers pay with Stripe Checkout"],
        open: ["Admin sees stock changes"],
      },
      settings: ["STRIPE_SECRET_KEY"],
    });
    // The server continues into generation by itself: the CLI asks only if the plan stays planned.
    expect(calls[0]).toBe("POST /v1/plans?wait=0");
    expect(calls).toContain(`GET /v1/plans/${ID}/package?format=app`);

    expect(existsSync(join(cwd, "src/app/page.tsx"))).toBe(true);
    const claude = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(claude.startsWith("@AGENTS.md")).toBe(true);
    expect(claude).toContain("turbineh build");
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toMatch(/\.turbineh\/project\.json/);
    expect(git("log", "--format=%an|%s")).toMatch(
      /^TurbineH\|feat: Northwind Coffee — verified TurbineH package/,
    );
    expect(git("status", "--porcelain")).toBe("");

    const d = r.data as {
      gitIdentity: string;
      criteria: { met: number; open: number; items: { status: string; where?: string }[] };
      settings: { required: string[]; missing: string[] };
      gate: { ok: boolean };
    };
    expect(d.gitIdentity).toBe("fallback");
    expect(d.criteria).toMatchObject({ met: 1, open: 1 });
    expect(d.criteria.items[1]?.where).toBe("src/app/admin, tests/e2e/app.spec.ts");
    // DATABASE_URL is served by the package's local database: only the Stripe key is missing.
    expect(d.settings.missing).toEqual(["STRIPE_SECRET_KEY"]);
    expect(r.next).toMatch(/1 open item/);
    expect(readProject(cwd)?.pending).toBeUndefined();
    expect(readProject(cwd)?.builds?.[0]?.id).toBe(ID);
  });

  it("exit 6 when the gate is not green, still written and committed", async () => {
    states = ["planning", "generating", "generated"];
    const r = await build(ctx(["online shop with Stripe checkout"]));
    expect(r.exitCode).toBe(EXIT.notGreen);
    expect(git("log", "--oneline").split("\n")).toHaveLength(1);
  });

  it("exit 4 on timeout with a resume command; resume finishes the job", async () => {
    states = ["planning", "generating"];
    const r = await build(ctx(["online shop with Stripe checkout"], { timeout: "0.0001" }));
    expect(r.exitCode).toBe(EXIT.timeout);
    expect(r.error?.resume).toBe(`turbineh resume ${ID}`);
    expect(readProject(cwd)?.pending?.id).toBe(ID);
    states = ["verified"];
    const { result, exitCode } = await runCommand("resume", ctx([]));
    expect(exitCode).toBe(EXIT.ok);
    expect(result.command).toBe("build");
    expect(readProject(cwd)?.pending).toBeUndefined();
  });

  it("exit 3 when the plan needs a decision; --approve generates", async () => {
    needsApproval = ["Uses a component under a licence outside your policy"];
    states = ["planned"];
    const r = await build(ctx(["online shop with Stripe checkout"]));
    expect(r.exitCode).toBe(EXIT.decision);
    expect(r.error?.resume).toBe(`turbineh resume ${ID} --approve`);
    const ok = await runCommand("resume", ctx([ID], { approve: true }));
    expect(ok.exitCode).toBe(EXIT.ok);
    expect(calls).toContain(`POST /v1/plans/${ID}/generate`);
  });

  it("exit 5 when generation fails, nothing written", async () => {
    states = ["planning", "failed"];
    const r = await build(ctx(["online shop with Stripe checkout"]));
    expect(r.exitCode).toBe(EXIT.failed);
    expect(existsSync(join(cwd, "package.json"))).toBe(false);
  });

  it("refuses a folder with files but no package.json (exit 2-class usage of the right folder)", async () => {
    writeFileSync(join(cwd, "main.py"), "print(1)\n");
    expect(targetOf(cwd)).toBeNull();
    const { exitCode, result } = await runCommand("build", ctx(["online shop with Stripe"]));
    expect(result.error?.code).toBe("not_a_project");
    expect(exitCode).toBe(1);
  });
});

describe("turbineh build — existing project → adapted capability", () => {
  beforeEach(() => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify(
        {
          name: "acme",
          private: true,
          scripts: { build: "next build", test: "vitest run" },
          dependencies: { next: "16.3.8", react: "19.3.0" },
          devDependencies: { typescript: "6.0.3", vitest: "5.0.2" },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    mkdirSync(join(cwd, "src/app"), { recursive: true });
    writeFileSync(join(cwd, "src/app/page.tsx"), "export default function P() { return null; }\n");
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("-c", "user.name=a", "-c", "user.email=a@a", "commit", "-q", "-m", "app");
  });

  it("writes the capability in its own folder on a new branch, touching only what it must", async () => {
    writeFileSync(join(cwd, "NOTES.local.md"), "my uncommitted notes\n");
    const r = await build(ctx(["notes service for the team"]));
    expect(r.exitCode).toBe(EXIT.ok);
    expect(git("branch", "--show-current")).toBe(`turbineh/notes-${ID.slice(0, 8)}`);
    const changed = git("show", "--name-only", "--format=", "HEAD").split("\n");
    expect(changed).toContain("src/turbineh/notes/lib/notes.ts");
    expect(
      changed.every(
        (p) => p.startsWith("src/turbineh/notes/") || ["package.json", ".env.example"].includes(p),
      ),
    ).toBe(true);
    expect(changed).not.toContain("src/app/page.tsx");
    // The user's uncommitted work stays uncommitted and untouched.
    expect(git("status", "--porcelain")).toContain("NOTES.local.md");
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.zod).toBe("4.6.5");
    expect(pkg.dependencies.next).toBe("16.3.8");
    expect(r.data).toMatchObject({
      target: "repo",
      files: { folder: "src/turbineh/notes" },
      settings: { missing: ["NOTES_API_KEY"] },
    });
    expect(readProject(cwd)?.integrations[0]?.dir).toBe("src/turbineh/notes");
    expect(r.next).toMatch(/^pnpm install/);
  });

  it("refuses to mix uncommitted changes of a file it must modify (exit 7)", async () => {
    writeFileSync(
      join(cwd, "package.json"),
      readFileSync(join(cwd, "package.json"), "utf8").replace('"acme"', '"acme2"'),
    );
    const { exitCode, result } = await runCommand("build", ctx(["notes service for the team"]));
    expect(exitCode).toBe(EXIT.conflict);
    expect(result.error?.code).toBe("dirty_files");
    expect(result.error?.resume).toBe(`turbineh resume ${ID}`);
  });
});

describe("spec input and agent instructions", () => {
  it("reads @file and rejects specs beyond the limit with an action", async () => {
    writeFileSync(join(cwd, "s.md"), "x".repeat(30));
    expect(await readSpec(ctx(["@s.md"]))).toBe("x".repeat(30));
    writeFileSync(join(cwd, "big.md"), "x".repeat(20_001));
    await expect(readSpec(ctx(["@big.md"]))).rejects.toThrow(/20000/);
  });

  it("merges agent files and the .gitignore, never overwrites other files of the folder", () => {
    writeFileSync(join(cwd, "README.md"), "mine\n");
    writeFileSync(join(cwd, ".gitignore"), "dist/\n");
    const r = writeAppFiles(cwd, [
      { path: "app/README.md", data: Buffer.from("theirs\n") },
      { path: "app/.gitignore", data: Buffer.from("node_modules/\ndist/\n") },
      { path: "app/../evil.txt", data: Buffer.from("x") },
    ]);
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(cwd, "README.turbineh.md"), "utf8")).toBe("theirs\n");
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("dist/\nnode_modules/\n");
    expect(r.kept).toEqual([{ path: "README.md", packageCopy: "README.turbineh.md" }]);
    expect(existsSync(join(cwd, "..", "evil.txt"))).toBe(false);
  });

  it("init block is idempotent and replaces the previous TurbineH section", () => {
    const once = upsertBlock("# Project\n");
    expect(upsertBlock(once)).toBe(once);
    const legacy = "# P\n\n## TurbineH capabilities\n\nold text\n\n## Other\nkeep\n";
    const up = upsertBlock(legacy);
    expect(up).not.toContain("old text");
    expect(up).toContain("## Other\nkeep");
    expect(AGENT_BLOCK.split("\n").length).toBeLessThan(20);
  });

  it("the Claude Code skill uses documented frontmatter fields only", () => {
    const md = skillMarkdown("https://example.test");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? "";
    const keys = front.split("\n").map((l) => l.split(":")[0]);
    expect(keys).toEqual(["name", "description", "allowed-tools"]);
    expect(/description: (.*)/.exec(front)?.[1]?.length).toBeLessThan(1536);
    expect(md).toContain("https://example.test/install.sh");
    writeAgentFiles(cwd, "claude", "https://example.test");
    expect(existsSync(join(cwd, ".claude/skills/turbineh/SKILL.md"))).toBe(true);
    writeAgentFiles(cwd, "codex", "https://example.test");
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("turbineh build");
  });
});

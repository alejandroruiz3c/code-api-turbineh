import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXED_RULES } from "./fixes.js";
import {
  envSecretLiterals,
  GITLEAKS_IMAGE,
  licenceScan,
  localGate,
  parseGitleaks,
  type Exec,
} from "./local-gate.js";
import { RULES_DIR, RULES_FILE, SEMGREP_IMAGE } from "./verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ENV = join(here, "../../../catalog/recipes/saas-crud/template/src/env.ts");

/** The learning round's bookings src/env.ts (G4b): the placeholder the agent wrote so `next build` would pass. */
const LEARNING_ENV = `import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  RESEND_API_KEY: z.string().optional(),
  ADMIN_EMAILS: z.string().default(""),
});

const building = process.env.NEXT_PHASE === "phase-production-build";
export const env = schema.parse(
  building
    ? {
        DATABASE_URL: "postgres://build-placeholder",
        BETTER_AUTH_SECRET: "build-placeholder-build-placeholder-0",
        BETTER_AUTH_URL: "http://localhost:3000",
        ...process.env,
      }
    : process.env,
);
`;

/** A GitHub token shape, generated at runtime so no secret-shaped literal enters this repository. */
const fakeToken = () =>
  `ghp_${randomBytes(27)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "a")
    .slice(0, 36)}`;

const UNAUTHORISED_ACTION = `"use server";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function deleteNote(id: string) {
  await db.delete(notes).where(eq(notes.id, id));
}
`;

function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/**
 * A package with the three kinds of blocking finding: a leaked-looking token (one committed, one not yet), an
 * unauthorised server action, a GPL dependency installed — plus the learning round's env.ts placeholder.
 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "local-gate-"));
  write(dir, {
    ".gitignore": "node_modules\n.next\n",
    "package.json": JSON.stringify({ name: "fixture", dependencies: { "gpl-lib": "1.0.0" } }),
    "src/app/notes/actions.ts": UNAUTHORISED_ACTION,
    "src/lib/github.ts": `export const githubToken = "${fakeToken()}";\n`,
    "src/env.ts": LEARNING_ENV,
    "node_modules/.pnpm/gpl-lib@1.0.0/node_modules/gpl-lib/package.json": JSON.stringify({
      name: "gpl-lib",
      version: "1.0.0",
      license: "GPL-3.0-only",
    }),
    "node_modules/.pnpm/dual@2.0.0/node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      version: "2.0.0",
      license: "(MIT OR GPL-3.0-or-later)",
    }),
    "node_modules/.pnpm/@scope+ok@1.0.0/node_modules/@scope/ok/package.json": JSON.stringify({
      name: "@scope/ok",
      version: "1.0.0",
      license: { type: "MIT" },
    }),
  });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      stdio: "ignore",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  // Not committed yet: the next commit would add it, so verify --full flags it before the gate does.
  write(dir, { "src/lib/later.ts": `export const token = "${fakeToken()}";\n` });
  return dir;
}

const imagePresent = (image: string) => {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const scannersPresent = imagePresent(GITLEAKS_IMAGE) && imagePresent(SEMGREP_IMAGE);

describe("src/env.ts secret-shaped literals (G4b, tool-free)", () => {
  it("flags the learning round's build placeholder as the gate would, and nothing in the template", () => {
    const found = envSecretLiterals(LEARNING_ENV);
    expect(found).toEqual([
      expect.objectContaining({ key: "BETTER_AUTH_SECRET", line: 15, gateRule: true }),
    ]);
    expect(envSecretLiterals(readFileSync(TEMPLATE_ENV, "utf8"))).toEqual([]);
  });

  it("also flags secret defaults, fallbacks and URLs with a password (not blocking: the gate does not)", () => {
    const found = envSecretLiterals(`const schema = z.object({
  STRIPE_SECRET_KEY: z.string().default("sk_dev_value"),
  SESSION_TOKEN_TTL: z.string().default("3600"),
  EMAIL_FROM: z.string().default("App <a@b.c>"),
});
const url = { DATABASE_URL: "postgres://app:hunter2@db:5432/app" };
const key = process.env.API_KEY ?? "dev-key";
// A comment: PASSWORD: "not-code-at-all-really"
`);
    expect(found.map((f) => [f.key, f.why, f.gateRule])).toEqual([
      ["STRIPE_SECRET_KEY", "a default value", false],
      ["DATABASE_URL", "a URL with a password", false],
      ["API_KEY", "a fallback value", false],
    ]);
  });
});

describe("licence policy (in-process, the gate's semantics)", () => {
  it("blocks the GPL package, not the dual-licensed one", () => {
    const dir = mkdtempSync(join(tmpdir(), "local-licences-"));
    write(dir, {
      "node_modules/.pnpm/gpl-lib@1.0.0/node_modules/gpl-lib/package.json": JSON.stringify({
        name: "gpl-lib",
        version: "1.0.0",
        license: "GPL-3.0-only",
      }),
      "node_modules/.pnpm/dual@2.0.0/node_modules/dual/package.json": JSON.stringify({
        name: "dual",
        version: "2.0.0",
        license: "(MIT OR GPL-3.0-or-later)",
      }),
    });
    expect(licenceScan(dir)).toEqual({ total: 2, blocking: ["gpl-lib@1.0.0 GPL-3.0-only"] });
    expect(licenceScan(mkdtempSync(join(tmpdir(), "local-empty-")))).toBeNull();
  });
});

describe("gitleaks report", () => {
  it("keeps rule, file, line and commit only (redacted values never read)", () => {
    const hits = parseGitleaks(
      JSON.stringify([
        {
          RuleID: "github-pat",
          Description: "GitHub Personal Access Token",
          File: "/src/a.ts",
          StartLine: 3,
          Secret: "REDACTED",
          Match: "REDACTED",
          Commit: "abcdef1234",
        },
      ]),
    );
    expect(hits).toEqual([
      {
        RuleID: "github-pat",
        Description: "GitHub Personal Access Token",
        File: "/src/a.ts",
        StartLine: 3,
        Commit: "abcdef1234",
      },
    ]);
    expect(parseGitleaks("not json")).toBeNull();
  });
});

describe("every gate rule has a fix", () => {
  it("covers each Semgrep rule id", () => {
    const ids = [
      ...readFileSync(join(RULES_DIR, RULES_FILE), "utf8").matchAll(/- id: (turbineh\.[\w-]+)/g),
    ].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(FIXED_RULES, id).toContain(id);
  });
});

describe("local gate without scanners", () => {
  it("reports a check that could not run as not run, never as clean, and fails", async () => {
    const dir = fixture();
    const calls: string[] = [];
    const exec: Exec = async (cmd, args) => {
      calls.push(`${cmd} ${args[0]}`);
      return { code: 127, stdout: "", stderr: "not found" };
    };
    const r = await localGate(dir, { exec, offline: true });
    expect(r.complete).toBe(false);
    expect(r.ok).toBe(false);
    const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    expect(byName.secrets?.ran).toBe(false);
    expect(byName.secrets?.detail).toContain("gitleaks 8.30.1");
    expect(byName.static?.ran).toBe(false);
    expect(byName.static?.detail).toContain("semgrep 1.178.0");
    expect(byName.dependencies?.ran).toBe(false);
    // The tool-free checks still ran and still report.
    expect(byName["env-literals"]?.ran).toBe(true);
    expect(byName.licenses?.ran).toBe(true);
    expect(r.findings.map((f) => [f.category, f.rule, f.where, f.blocking])).toEqual([
      ["policy", "turbineh.hardcoded-secret", "src/env.ts:15", true],
      ["policy", "licence-policy", "gpl-lib@1.0.0", true],
    ]);
    // Never a docker run without Docker, never a scanner of another version.
    expect(calls.filter((c) => c === "docker run")).toEqual([]);
  });

  it("uses a local binary only at the pinned version", async () => {
    const dir = fixture();
    const exec: Exec = async (cmd, args) => {
      if (cmd === "gitleaks" && args[0] === "version")
        return { code: 0, stdout: "8.18.0\n", stderr: "" };
      if (cmd === "semgrep" && args[0] === "--version")
        return { code: 0, stdout: "1.100.0\n", stderr: "" };
      return { code: 127, stdout: "", stderr: "" };
    };
    const r = await localGate(dir, { exec, offline: true });
    expect(r.checks.find((c) => c.name === "secrets")?.ran).toBe(false);
    expect(r.checks.find((c) => c.name === "static")?.ran).toBe(false);
  });

  it("sends OSV package coordinates only and maps advisories like the gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "local-osv-"));
    write(dir, {
      "pnpm-lock.yaml": `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      left-pad:
        specifier: 1.0.0
        version: 1.0.0
packages:
  left-pad@1.0.0: {}
snapshots:
  left-pad@1.0.0: {}
`,
    });
    const bodies: string[] = [];
    const fake = (async (url: string, init?: { body?: string }) => {
      if (init?.body) bodies.push(init.body);
      const json = url.endsWith("querybatch")
        ? { results: [{ vulns: [{ id: "GHSA-test-0001" }] }] }
        : { database_specific: { severity: "HIGH" } };
      return { ok: true, status: 200, json: async () => json };
    }) as unknown as typeof fetch;
    const exec: Exec = async () => ({ code: 127, stdout: "", stderr: "" });
    const r = await localGate(dir, { exec, fetch: fake });
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({
      queries: [{ package: { name: "left-pad", ecosystem: "npm" }, version: "1.0.0" }],
    });
    expect(r.findings).toEqual([
      expect.objectContaining({
        category: "security",
        rule: "GHSA-test-0001",
        where: "left-pad@1.0.0",
        blocking: true,
        fix: expect.stringContaining("Upgrade left-pad"),
      }),
    ]);
  });
});

describe.skipIf(!scannersPresent)("local gate with the pinned scanners (Docker)", () => {
  it(
    "finds the leaked-looking tokens (committed and not), the unauthorised action and the GPL licence",
    { timeout: 600_000 },
    async () => {
      const dir = fixture();
      const r = await localGate(dir, { offline: true });
      const seen = r.findings.map((f) => [f.category, f.rule, f.where, f.blocking]);
      expect(seen).toEqual(
        expect.arrayContaining([
          ["security", "gitleaks", "src/lib/github.ts:1", true],
          ["security", "gitleaks", "src/lib/later.ts:1", true],
          ["security", "turbineh.server-action-without-authz", "src/app/notes/actions.ts:6", true],
          ["policy", "turbineh.hardcoded-secret", "src/env.ts:15", true],
          ["policy", "licence-policy", "gpl-lib@1.0.0", true],
        ]),
      );
      const leak = r.findings.find((f) => f.where === "src/lib/github.ts:1");
      expect(leak?.message).toMatch(/in commit [0-9a-f]{7}/);
      expect(r.findings.find((f) => f.where === "src/lib/later.ts:1")?.message).toContain(
        "not committed yet",
      );
      // Redacted: no token value anywhere in the result.
      expect(JSON.stringify(r)).not.toMatch(/ghp_[A-Za-z0-9]{10}/);
      for (const f of r.findings) expect(f.fix?.length ?? 0).toBeGreaterThan(20);
      expect(r.checks.find((c) => c.name === "secrets")?.via).toBe("docker gitleaks 8.30.1");
      expect(r.checks.find((c) => c.name === "static")?.via).toBe("docker semgrep 1.178.0");
      expect(r.ok).toBe(false);
    },
  );

  it(
    "embedded rules text gives the same findings as the rules folder (CLI bundle)",
    { timeout: 600_000 },
    async () => {
      const dir = fixture();
      const rulesYaml = readFileSync(join(RULES_DIR, RULES_FILE), "utf8");
      const [a, b] = await Promise.all([
        localGate(dir, { offline: true }),
        localGate(dir, { offline: true, rulesYaml }),
      ]);
      const statics = (x: typeof a) =>
        x.findings.filter((f) => f.rule.startsWith("turbineh.")).map((f) => f.where);
      expect(statics(b)).toEqual(statics(a));
    },
  );
});

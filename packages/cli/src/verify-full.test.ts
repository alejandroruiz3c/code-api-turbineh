import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalGateResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import type { Ctx } from "./commands.js";
import { runCommand } from "./registry.js";
import { verifyFull } from "./verify-full.js";

const gateResult = (over: Partial<LocalGateResult> = {}): LocalGateResult => ({
  ok: true,
  complete: true,
  checks: [
    { name: "secrets", ran: true, via: "docker gitleaks 8.30.1", ms: 1, detail: "" },
    { name: "static", ran: true, via: "docker semgrep 1.178.0", ms: 1, detail: "" },
  ],
  findings: [],
  ...over,
});

const ACTION = {
  category: "security" as const,
  rule: "turbineh.server-action-without-authz",
  where: "src/app/actions.ts:28",
  blocking: true,
  message: "Exported server action does not check who is calling it.",
  fix: "First line of the action: await requireMember() …",
};

function project(scripts: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vfull-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return dir;
}

describe("turbineh verify --full", () => {
  it("prints file:line, the rule, the label and the fix, and fails on a blocking finding", async () => {
    const r = await verifyFull(project(), {
      skipScripts: true,
      gate: async () => gateResult({ ok: false, findings: [ACTION] }),
    });
    expect(r.ok).toBe(false);
    expect(r.state).toBe("blocking_findings");
    expect(r.error).toMatchObject({ code: "blocking_findings", resume: "turbineh verify --full" });
    // --json: the gate findings' shape (turbineh.json gate.findings), nothing else.
    expect((r.data as { findings: unknown[] }).findings).toEqual([ACTION]);
    const human = (r.lines ?? []).join("\n");
    expect(human).toContain(
      "[security] turbineh.server-action-without-authz at src/app/actions.ts:28",
    );
    expect(human).toContain("fix: First line of the action");
  });

  it("does not count a check that could not run as clean", async () => {
    const r = await verifyFull(project(), {
      skipScripts: true,
      gate: async () =>
        gateResult({
          ok: false,
          complete: false,
          checks: [
            { name: "secrets", ran: false, via: "", ms: 0, detail: "Not run: needs Docker" },
          ],
        }),
    });
    expect(r.ok).toBe(false);
    expect(r.state).toBe("incomplete");
    expect(r.error?.code).toBe("checks_not_run");
  });

  it("adds the project's typecheck, lint and unit tests as quality findings", async () => {
    const r = await verifyFull(project({ typecheck: "tsc", lint: "eslint .", test: "vitest" }), {
      gate: async () => gateResult(),
      run: (_cmd, args) =>
        args[1] === "lint"
          ? { ok: false, detail: "/w/src/lib/a.ts\n  3:10  error  'x' is unused  no-unused-vars" }
          : { ok: true, detail: "" },
    });
    expect(r.ok).toBe(false);
    expect((r.data as { findings: unknown[] }).findings).toEqual([
      expect.objectContaining({
        category: "quality",
        rule: "lint",
        where: "src/lib/a.ts:3",
        blocking: true,
        fix: expect.stringContaining("pnpm lint"),
      }),
    ]);
  });

  it("passes with no blocking finding and every check run (alerts are still listed)", async () => {
    const alert = { ...ACTION, rule: "GHSA-x", where: "braces@3.0.3", blocking: false };
    const r = await verifyFull(project(), {
      skipScripts: true,
      gate: async () => gateResult({ findings: [alert] }),
    });
    expect(r.ok).toBe(true);
    expect(r.state).toBe("verified_locally");
    expect((r.lines ?? []).join("\n")).toContain("(not blocking)");
  });

  it("is what `turbineh verify --full` runs; a check not run exits 1", async () => {
    const ctx: Ctx = {
      cwd: project(),
      args: [],
      flags: { full: true, "skip-scripts": true, offline: true },
      json: true,
      confirm: async () => false,
    };
    const { result, exitCode } = await runCommand("verify", ctx);
    expect(result.command).toBe("verify");
    expect((result.data as { full: boolean }).full).toBe(true);
    // --offline: OSV did not run, so the local gate can never pass.
    expect(exitCode).toBe(1);
  }, 600_000);
});

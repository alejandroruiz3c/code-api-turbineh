import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bold, dim, green, red, yellow, type CommandResult } from "./output.js";

/**
 * Delivered packages (TurbineH builds) carry turbineh.json (schema turbineh.package/v1, written by the assembler):
 * `turbineh left` prints what is left from it; `turbineh verify` inside such a package runs the cheap local checks and
 * points every failure to the exact file:line and the fix.
 */
export interface PackageGuideFile {
  schema: string;
  buildId: string;
  app: { name: string };
  status: "verified" | "failed" | "unverified";
  left: { kind: string; what: string; where: string; how: string }[];
  criteria: { text: string; status: string; test?: { file: string; title: string } }[];
  gate: {
    ok: boolean;
    verifiedAt: string;
    steps: { name: string; ok: boolean }[];
    findings: {
      category: string;
      rule: string;
      where: string;
      blocking: boolean;
      message: string;
    }[];
  } | null;
  env: { required: { name: string }[] };
  rerun: { change: string; run: string; note: string }[];
}

export function readGuide(cwd: string): PackageGuideFile | null {
  const p = join(cwd, "turbineh.json");
  if (!existsSync(p)) return null;
  const g = JSON.parse(readFileSync(p, "utf8")) as PackageGuideFile;
  return g.schema?.startsWith("turbineh.package/") ? g : null;
}

/** Required settings missing from .env.local / .env / the environment. */
export function missingSettings(cwd: string, names: string[]): string[] {
  const set = new Set(Object.keys(process.env).filter((k) => process.env[k]));
  for (const f of [".env.local", ".env"]) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line.trim());
      if (m?.[1] && m[2]) set.add(m[1]);
    }
  }
  return names.filter((n) => !set.has(n));
}

export function left(cwd: string, guide: PackageGuideFile): CommandResult {
  const missing = missingSettings(
    cwd,
    guide.env.required.map((e) => e.name),
  );
  const items = [
    ...guide.left,
    ...missing.map((name) => ({
      kind: "setting",
      what: `${name} is not set`,
      where: ".env.local",
      how: "Copy .env.example to .env.local and fill it in (never commit it).",
    })),
  ];
  const met = guide.criteria.filter((c) => c.status === "met").length;
  return {
    ok: true,
    command: "left",
    state: guide.status,
    data: { status: guide.status, left: items, criteria: guide.criteria, rerun: guide.rerun },
    lines: [
      bold(`${guide.app.name} — build ${guide.buildId.slice(0, 8)}`),
      `Gate: ${
        guide.gate
          ? guide.gate.ok
            ? green(`passed (${guide.gate.verifiedAt})`)
            : red(`failed (${guide.gate.verifiedAt})`)
          : yellow("not verified yet")
      } · Criteria met: ${met}/${guide.criteria.length}`,
      "",
      items.length ? bold("Left to do:") : green("Nothing left: the package meets its spec."),
      ...items.map(
        (l) =>
          `  ${yellow("•")} [${l.kind}] ${l.what}\n    ${dim(`where: ${l.where} — how: ${l.how}`)}`,
      ),
      "",
      bold("After a change, re-run only:"),
      ...guide.rerun.map((r) => `  ${r.change}: ${r.run}`),
    ],
    next: items.length
      ? "Do the first item; details in AGENTS.md."
      : "Make only the changes your task asks for; re-run the matching command above.",
  };
}

/** "file:line" from tsc / ESLint / Vitest output (first one), or null. */
export function locate(output: string): string | null {
  const tsc = /((?:src|tests|scripts)\/[\w./[\]-]+\.[cm]?[jt]sx?)\((\d+),\d+\)/.exec(output);
  if (tsc) return `${tsc[1]}:${tsc[2]}`;
  const eslint =
    /^\/?(?:[\w.-]+\/)*?((?:src|tests|scripts)\/[\w./[\]-]+\.[cm]?[jt]sx?)\n\s+(\d+):\d+\s+error/m.exec(
      output,
    );
  if (eslint) return `${eslint[1]}:${eslint[2]}`;
  const any = /((?:src|tests|scripts)\/[\w./[\]-]+\.[cm]?[jt]sx?):(\d+)/.exec(output);
  return any ? `${any[1]}:${any[2]}` : null;
}

/** The first line that explains a failure. */
export function firstError(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(">"));
  return (
    lines.find((l) => /\berror\b|✗|×|FAIL|AssertionError|Expected/i.test(l)) ?? lines.at(-1) ?? ""
  );
}

const FIX: Record<string, string> = {
  typecheck: "Fix the type error at that line, then `pnpm typecheck`.",
  lint: "Fix the lint error at that line (or run `pnpm lint --fix`), then `pnpm lint`.",
  test: "Fix the code or the unit test, then `pnpm exec vitest run <that test file>`.",
};

/** Package mode of `turbineh verify`: typecheck, lint and unit tests here, each failure with file:line and the fix. */
export function verifyPackage(
  cwd: string,
  guide: PackageGuideFile,
  run: (cmd: string, args: string[]) => { ok: boolean; detail: string } = (cmd, args) => {
    try {
      execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
      return { ok: true, detail: "" };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      return { ok: false, detail: `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}` };
    }
  },
): CommandResult {
  const checks = ["typecheck", "lint", "test"].map((name) => {
    const r = run("pnpm", ["-s", name]);
    return {
      name,
      ok: r.ok,
      ...(r.ok
        ? {}
        : { where: locate(r.detail), error: firstError(r.detail).slice(0, 300), fix: FIX[name] }),
    };
  });
  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  return {
    ok,
    command: "verify",
    state: ok ? "verified_locally" : "checks_failed",
    data: {
      checks,
      notRunHere:
        "build, E2E and the security/licence scans: run `pnpm build && pnpm test:e2e` for a flow change (see AGENTS.md), the full TurbineH gate runs on delivery.",
      gate: guide.gate,
    },
    lines: [
      bold(`Local checks of ${guide.app.name}`),
      ...checks.map((c) =>
        c.ok
          ? `  ${green("✔")} ${c.name}`
          : `  ${red("✖")} ${c.name} at ${c.where ?? "(see output)"} — ${c.error}\n    ${dim(c.fix ?? "")}`,
      ),
    ],
    ...(ok
      ? {
          next: "Typecheck, lint and unit tests pass. For page/flow changes run the one E2E spec (AGENTS.md).",
        }
      : {
          error: {
            code: `check_failed_${failed[0]?.name}`,
            message: `${failed[0]?.name} failed${failed[0]?.where ? ` at ${failed[0].where}` : ""}.`,
            action: failed[0]?.fix ?? "Fix it and run turbineh verify again.",
            resume: "turbineh verify",
          },
        }),
  };
}

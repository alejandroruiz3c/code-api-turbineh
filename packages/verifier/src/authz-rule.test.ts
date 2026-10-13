import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { staticScan } from "./verify.js";

/** Runs only where the pinned Semgrep image is present (worker hosts, local); CI skips it. */
const semgrepAvailable = (() => {
  try {
    return (
      execFileSync("docker", ["images", "-q", "semgrep/semgrep"], { encoding: "utf8" }).trim()
        .length > 0
    );
  } catch {
    return false;
  }
})();

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "authz-rule-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const RULE = "turbineh.server-action-without-authz";

describe.skipIf(!semgrepAvailable)(RULE, () => {
  it(
    "exempts sign-in / sign-out / sign-up actions (the three false positives of the Frontiers alone runs)",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        // Frontiers shop · alone: app/admin/actions.ts
        "app/admin/actions.ts": `"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/admin/login");
}
`,
        // Frontiers agent · alone: src/app/staff/actions.ts (loginAction, logoutAction) + a sign-up action
        "src/app/staff/actions.ts": `"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function loginAction(_prev: unknown, formData: FormData) {
  try {
    await getAuth().api.signInEmail({ body: { email: String(formData.get("email")) }, headers: await headers() });
  } catch {
    return { error: "Invalid email or password." };
  }
  redirect("/staff");
}

export async function logoutAction() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/staff/login");
}

export async function signUpAction(formData: FormData) {
  await getAuth().api.signUpEmail({ body: { email: String(formData.get("email")) } });
}
`,
      });
      const findings = (await staticScan(dir)) ?? [];
      expect(findings.filter((f) => f.rule === RULE)).toEqual([]);
    },
  );

  it(
    "still flags every other action without an authorization call",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        "src/app/staff/actions.ts": `"use server";
import { db } from "@/db";
import { requireStaff } from "@/lib/session";

export async function staffCancelAction(id: string) {
  await db.delete(id);
}

export async function signOutEveryone() {
  await db.deleteAllSessions();
}

export async function loginAsUser(id: string) {
  await db.impersonate(id);
}

export async function guarded(id: string) {
  await requireStaff();
  await db.delete(id);
}
`,
      });
      const findings = (await staticScan(dir)) ?? [];
      const hits = findings.filter((f) => f.rule === RULE).map((f) => f.line);
      // staffCancelAction (5), signOutEveryone (9), loginAsUser (13); `guarded` checks first.
      expect(hits.sort((a, b) => a - b)).toEqual([5, 9, 13]);
    },
  );
});

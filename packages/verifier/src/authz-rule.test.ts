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
  // Learning round 2026-10-13 (ANALYSIS §12, G4): the three FAILs on legitimate actions, exactly as the agents wrote
  // them, then rewritten with the blessed helpers of src/server/authz.ts.
  const ORIGINAL = {
    // bookings (Sala Nueve) src/app/actions.ts:28,50 — public booking and cancel link, own rate limit + Zod.
    "src/app/actions.ts": `"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/security/rate-limit";
import { cancelByToken, createBooking } from "@/server/booking-service";

export type FormState = { ok: boolean; message: string } | null;
const bookSchema = z.object({ serviceId: z.uuid(), startsAt: z.iso.datetime() });
async function clientKey(): Promise<string> {
  return (await headers()).get("x-forwarded-for") ?? "local";
}
export async function bookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!rateLimit(\`book:\${await clientKey()}\`)) return { ok: false, message: "Too many requests." };
  const parsed = bookSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the form and try again." };
  const result = await createBooking(parsed.data);
  if (!result.ok) return result;
  redirect(\`/booked?id=\${result.bookingId}\`);
}
export async function cancelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!rateLimit(\`cancel:\${await clientKey()}\`)) return { ok: false, message: "Too many requests." };
  const token = z.string().max(100).safeParse(formData.get("token"));
  if (!token.success) return { ok: false, message: "This cancellation link is not valid." };
  return cancelByToken(token.data);
}
`,
    // client-portal (Ledgerline) src/app/invite/[token]/actions.ts:19 — anonymous invitee creates the account.
    "src/app/invite/[token]/actions.ts": `"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/security/rate-limit";
import { claimInvitation } from "@/server/portal";

const schema = z.object({ token: z.string().min(20), name: z.string().min(1), password: z.string().min(10) });
export async function acceptInvite(formData: FormData): Promise<void> {
  const input = schema.safeParse(Object.fromEntries(formData));
  const h = await headers();
  if (!rateLimit(\`invite-accept:\${h.get("x-forwarded-for") ?? "local"}\`, 10)) return;
  await claimInvitation(input.data!, h);
}
`,
    // saas-crud (Fieldnote) src/entities/members/actions.ts:174 — the signed-in invitee is not a member yet.
    "src/entities/members/actions.ts": `"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { joinByToken } from "./invitations";

export async function acceptInvitation(formData: FormData): Promise<void> {
  const token = z.string().min(20).max(100).safeParse(formData.get("token"));
  if (!token.success) redirect("/");
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/sign-in");
  await joinByToken(token.data, session.user.id, session.user.email);
}
`,
  };

  it(
    "still flags the learning-round actions written without a blessed helper",
    { timeout: 300_000 },
    async () => {
      const findings = (await staticScan(app(ORIGINAL))) ?? [];
      const hits = findings
        .filter((f) => f.rule === RULE)
        .map((f) => `${f.path}:${f.line}`)
        .sort();
      expect(hits).toEqual([
        "src/app/actions.ts:13",
        "src/app/actions.ts:21",
        "src/app/invite/[token]/actions.ts:9",
        "src/entities/members/actions.ts:8",
      ]);
    },
  );

  it(
    "accepts them rewritten with publicAction() and requireSession()",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        "src/app/actions.ts": `"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicAction } from "@/server/authz";
import { cancelByToken, createBooking } from "@/server/booking-service";

export type FormState = { ok: boolean; message: string } | null;
const bookSchema = z.object({ serviceId: z.uuid(), startsAt: z.iso.datetime() });
const refuse = (reason: string): FormState => ({ ok: false, message: reason });

export const bookAction = publicAction(
  "book",
  { rateLimit: { limit: 10 }, schema: bookSchema, refuse },
  async (input): Promise<FormState> => {
    const result = await createBooking(input);
    if (!result.ok) return result;
    redirect(\`/booked?id=\${result.bookingId}\`);
  },
);

export const cancelAction = publicAction(
  "cancel",
  { schema: z.object({ token: z.string().max(100) }), rateLimit: { limit: 10 }, refuse },
  async ({ token }) => cancelByToken(token),
);
`,
        "src/app/invite/[token]/actions.ts": `"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { publicAction } from "@/server/authz";
import { claimInvitation } from "@/server/portal";

const schema = z.object({ token: z.string().min(20), name: z.string().min(1), password: z.string().min(10) });
export const acceptInvite = publicAction("invite-accept", { rateLimit: { limit: 10 }, schema }, async (input) => {
  await claimInvitation(input, await headers());
});
`,
        "src/entities/members/actions.ts": `"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/authz";
import { joinByToken } from "./invitations";

export async function acceptInvitation(formData: FormData): Promise<void> {
  const { userId, email } = await requireSession();
  const token = z.string().min(20).max(100).safeParse(formData.get("token"));
  if (!token.success) redirect("/");
  await joinByToken(token.data, userId, email);
}
`,
      });
      const findings = (await staticScan(dir)) ?? [];
      expect(findings.filter((f) => f.rule === RULE)).toEqual([]);
    },
  );

  it(
    "rejects publicAction without its rate limit or schema, and async arrow exports without a check",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        "src/app/actions.ts": `"use server";
import { z } from "zod";
import { publicAction, requireMember } from "@/server/authz";
import { db } from "@/db";

const schema = z.object({ email: z.email() });
export const ok = publicAction("a", { rateLimit: { limit: 5 }, schema }, async (i) => db.insert(i));
export const noLimit = publicAction("b", { schema }, async (i) => db.insert(i));
export const noSchema = publicAction("c", { rateLimit: { limit: 5 } }, async (i) => db.insert(i));
export const arrow = async (id: string) => {
  await db.delete(id);
};
export const fn = async function (id: string) {
  await db.delete(id);
};
export const guardedArrow = async (id: string) => {
  await requireMember();
  await db.delete(id);
};
`,
      });
      const findings = (await staticScan(dir)) ?? [];
      const hits = findings.filter((f) => f.rule === RULE).map((f) => f.line);
      // noLimit (8), noSchema (9), arrow (10), fn (13); `ok` and `guardedArrow` pass.
      expect(hits.sort((a, b) => a - b)).toEqual([8, 9, 10, 13]);
    },
  );
});

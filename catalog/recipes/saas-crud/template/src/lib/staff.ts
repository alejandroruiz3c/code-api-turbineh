import { env } from "@/env";
import { SIGN_UP_POLICY } from "@/lib/sign-up-policy";

/** Staff allowlist (ADMIN_EMAILS, comma-separated). Empty = nobody: deny by default. */
export function staffEmails(raw: string = env.ADMIN_EMAILS): string[] {
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaffEmail(email: string, raw: string = env.ADMIN_EMAILS): boolean {
  return staffEmails(raw).includes(email.trim().toLowerCase());
}

/** Whether `email` may create an account under this app's sign-up policy (src/lib/sign-up-policy.ts). */
export function maySignUp(
  email: string,
  policy: "open" | "staff" = SIGN_UP_POLICY,
  raw: string = env.ADMIN_EMAILS,
): boolean {
  return policy === "open" || isStaffEmail(email, raw);
}

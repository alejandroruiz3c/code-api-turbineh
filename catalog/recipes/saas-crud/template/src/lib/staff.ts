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

/**
 * Staff access: an allowlisted email that the user has PROVEN (emailVerified). Anyone can type the owner's address at
 * sign-up; only the owner can open the verification link sent to it.
 */
export function isStaff(
  user: { email: string; emailVerified?: boolean | null },
  raw: string = env.ADMIN_EMAILS,
): boolean {
  return user.emailVerified === true && isStaffEmail(user.email, raw);
}

/** Whether `email` may create an account under this app's sign-up policy (src/lib/sign-up-policy.ts). */
export function maySignUp(
  email: string,
  policy: "open" | "staff" = SIGN_UP_POLICY,
  raw: string = env.ADMIN_EMAILS,
): boolean {
  return policy === "open" || isStaffEmail(email, raw);
}

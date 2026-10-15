import { env } from "@/env";
import { SIGN_UP_POLICY } from "@/lib/sign-up-policy";
import { emailDomainAllowed, SIGN_UP_EMAIL_DOMAINS } from "@/server/permissions";

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

/**
 * Whether `email` may create an account under this app's sign-up policy (src/lib/sign-up-policy.ts) and the email
 * domains the request allows (SIGN_UP_EMAIL_DOMAINS in src/server/permissions.ts). Staff (ADMIN_EMAILS) always may.
 */
export function maySignUp(
  email: string,
  policy: "open" | "staff" = SIGN_UP_POLICY,
  raw: string = env.ADMIN_EMAILS,
  domains: readonly string[] = SIGN_UP_EMAIL_DOMAINS,
): boolean {
  if (isStaffEmail(email, raw)) return true;
  return policy === "open" && emailDomainAllowed(email, domains);
}

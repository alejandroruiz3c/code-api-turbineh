import type { Metadata } from "next";
import { StaffSignIn } from "./staff-sign-in";

export const metadata: Metadata = {
  title: "Staff sign-in — CODE-API-TURBINEH",
  robots: { index: false },
};

/**
 * Staff sign-in with GitHub (ADR-0061). The product itself has no sign-in (invitation token, ADR-0030); the internal
 * pages (/ops, /ops/report) need the GitHub account whose email is in OPS_ADMIN_EMAILS. Anyone can sign in; only
 * those emails see the internal pages (everyone else still gets a 404 there).
 */
export default async function StaffSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = (await searchParams).next;
  const target =
    typeof next === "string" && /^\/ops(\/[a-z-]*)?$/.test(next) ? next : "/ops/report";
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <p className="eyebrow">Internal · staff only</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">Staff sign-in</h1>
      <p className="mt-3 text-sm text-muted">
        Sign in with the GitHub account TurbineH has on its staff list to open the internal pages.
      </p>
      <StaffSignIn callbackURL={target} />
    </main>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/brand";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { entityNav } from "@/entities";
import { requireMember } from "@/server/authz";
import { myOrganizations } from "@/server/organizations";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { userId, organizationId } = await requireMember();
  const organizations = await myOrganizations(userId);
  return (
    <div className="flex min-h-screen">
      <nav aria-label="Main" className="w-56 border-r border-line bg-panel p-4">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2 font-semibold text-accent">
          {BRAND.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
            <img src={BRAND.logo} alt="" className="h-7 w-auto" />
          ) : null}
          __APP_NAME__
        </Link>
        <OrganizationSwitcher organizations={organizations} activeId={organizationId} />
        <ul className="flex flex-col gap-1 text-sm">
          {entityNav.map((e) => (
            <li key={e.href}>
              <Link className="block rounded px-2 py-1 hover:bg-subtle" href={e.href}>
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t border-line pt-4">
          <Link
            className="block rounded px-2 py-1 text-sm text-muted hover:bg-subtle"
            href="/dashboard/account"
          >
            Account
          </Link>
          <SignOutButton />
        </div>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/brand";
import { entityNav } from "@/entities";
import { requireMember } from "@/server/authz";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireMember();
  return (
    <div className="flex min-h-screen">
      <nav aria-label="Main" className="w-56 border-r border-slate-200 bg-white p-4">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2 font-semibold">
          {BRAND.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
            <img src={BRAND.logo} alt="" className="h-7 w-auto" />
          ) : null}
          __APP_NAME__
        </Link>
        <ul className="flex flex-col gap-1 text-sm">
          {entityNav.map((e) => (
            <li key={e.href}>
              <Link className="block rounded px-2 py-1 hover:bg-slate-100" href={e.href}>
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

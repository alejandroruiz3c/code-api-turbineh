"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/flows/new", label: "New flow" },
  { href: "/activity", label: "Activity" },
  { href: "/use", label: "How to use" },
];

/** Product-area navigation (no sign-in: access is by invitation token, ADR-0030). */
export function ProductNav() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/access") return null;
  return (
    <nav aria-label="Product" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {LINKS.map((l) => {
        const active = path === l.href || (l.href !== "/" && path.startsWith(`${l.href}/`));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={active ? "text-cream" : "text-muted hover:text-ice-2"}
          >
            {l.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/access", { method: "DELETE" });
          router.push("/access");
        }}
        className="text-xs text-muted underline-offset-4 hover:text-ice-2 hover:underline"
      >
        Leave
      </button>
    </nav>
  );
}

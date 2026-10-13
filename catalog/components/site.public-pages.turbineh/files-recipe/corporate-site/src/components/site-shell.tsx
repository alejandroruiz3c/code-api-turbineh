import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/brand";
import { collections } from "@/site-pages/config";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  // Public collections of site.public-pages.turbineh (portfolio, careers, team…), before Contact.
  ...collections.map((c) => ({ href: c.path, label: c.plural })),
  { href: "/contact", label: "Contact" },
];

/** Public website frame: header with navigation (with the public collections) and call to action, footer. */
export function SiteShell({ children, cta }: { children: ReactNode; cta: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-accent">
            {BRAND.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
              <img src={BRAND.logo} alt="" className="h-8 w-auto" />
            ) : null}
            __APP_NAME__
          </Link>
          <nav aria-label="Main">
            <ul className="flex flex-wrap items-center gap-5 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="hover:text-brand">
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/contact"
                  className="rounded-md bg-brand px-4 py-2 font-medium text-brand-contrast"
                >
                  {cta}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-panel py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-6">
          <span>© {new Date().getFullYear()} __APP_NAME__</span>
          <span className="flex gap-4">
            <Link href="/blog/rss.xml" className="underline">
              RSS
            </Link>
            <Link href="/sign-in" className="underline">
              Admin
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

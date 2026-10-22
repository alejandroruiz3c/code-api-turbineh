import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/brand";

/**
 * Frame of the public blog pages (component content.blog.turbineh): the app's name, Home, Blog and RSS. On a corporate
 * site this file is replaced by one that uses the site's own header and footer (files-recipe/corporate-site).
 */
export async function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-accent">
            {BRAND.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
              <img src={BRAND.logo} alt="" className="h-8 w-auto" />
            ) : null}
            __APP_NAME__
          </Link>
          <nav aria-label="Blog">
            <ul className="flex items-center gap-5 text-sm">
              <li>
                <Link href="/" className="hover:text-brand">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-brand">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/blog/rss.xml" className="hover:text-brand">
                  RSS
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

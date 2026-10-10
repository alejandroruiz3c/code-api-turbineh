import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SignInButton, SignOutButton } from "@/components/sign-in-button";
import { currentUser } from "@/server/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CODE-API-TURBINEH · prompt to verified repo",
  description:
    "Describe an app. We select audited components instead of generating everything, then build, test and security-scan it, and deliver a private GitHub repository.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=42dot+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="flex items-center gap-3 text-ice-2"
            aria-label="CODE-API-TURBINEH home"
          >
            <Logo className="h-7 w-auto" />
            <span className="eyebrow hidden sm:inline">code · api</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/catalog" className="hover:text-ice-2">
              Catalog
            </Link>
            <Link href="/docs" className="hover:text-ice-2">
              API
            </Link>
            {user ? (
              <span className="flex items-center gap-3">
                <span className="text-ice-2">{user.name}</span>
                <SignOutButton />
              </span>
            ) : (
              <SignInButton label="Sign in" />
            )}
          </nav>
        </header>
        {children}
        <footer className="mx-auto mt-24 max-w-6xl border-t border-line px-6 py-8 text-xs text-muted">
          <p>TurbineH · European sovereign AI lab · open-weights models, decisions by JEV · beta</p>
        </footer>
      </body>
    </html>
  );
}

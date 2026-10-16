import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ProductNav } from "@/components/product-nav";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "YES IF for Builders · TurbineH",
  description:
    "Secured software flows: verified capabilities for TypeScript, Next.js, PostgreSQL and Drizzle, ready to integrate — as a downloadable package or as a verified pull request into your repository. Open-source library (Apache-2.0).",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-teal focus:px-3 focus:py-1 focus:text-navy"
        >
          Skip to content
        </a>
        <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="flex items-center gap-3 text-ice-2" aria-label="Home">
            <Logo className="h-7 w-auto" />
            <span className="eyebrow hidden sm:inline">YES IF for Builders</span>
          </Link>
          <ProductNav />
        </header>
        <div id="main">{children}</div>
        <footer className="mx-auto mt-24 flex max-w-6xl flex-wrap justify-between gap-2 border-t border-line px-6 py-8 text-xs text-muted">
          <p>TurbineH · Secured software flows · open-source library (Apache-2.0)</p>
          <p>Invitation beta · European sovereign AI lab · open-weights models</p>
        </footer>
      </body>
    </html>
  );
}

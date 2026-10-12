import type { Metadata } from "next";
import { ApiKeys } from "@/components/api-keys";

export const metadata: Metadata = { title: "API keys — CODE-API-TURBINEH", robots: { index: false } };

export default function KeysPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Account</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">API keys</h1>
      <p className="mt-2 text-sm text-muted">
        Use a key to start builds from your code: <code className="text-teal">Authorization: Bearer tbh_…</code>. Each key
        is shown once, stored only as a hash, and can be revoked at any time.
      </p>
      <ApiKeys />
    </main>
  );
}

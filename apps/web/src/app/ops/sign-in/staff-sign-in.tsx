"use client";

import { useState } from "react";

/** Starts the GitHub sign-in (better-auth social sign-in) and comes back to `callbackURL`. */
export function StaffSignIn({ callbackURL }: { callbackURL: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  async function signIn() {
    setState("busy");
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !body.url) throw new Error("sign-in failed");
      window.location.href = body.url;
    } catch {
      setState("error");
    }
  }
  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={signIn}
        disabled={state === "busy"}
        className="rounded-full bg-amber px-5 py-3 text-sm font-semibold text-navy disabled:opacity-60"
      >
        {state === "busy" ? "Opening GitHub…" : "Sign in with GitHub"}
      </button>
      {state === "error" ? (
        <p className="mt-3 text-sm text-bad">Could not start the GitHub sign-in. Try again.</p>
      ) : null}
    </div>
  );
}

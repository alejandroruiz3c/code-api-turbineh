"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: "SaaS with teams",
    prompt:
      "A SaaS for language schools: schools as workspaces with admin and teacher roles; manage students (name, email, level, enrolled on) and courses (title, teacher, weekly hours, price).",
  },
  {
    label: "Landing + waitlist",
    prompt:
      "A landing page for my coffee subscription startup BeanBox with a waitlist form, confirmation email and an admin panel to see signups.",
  },
  {
    label: "Internal tool",
    prompt:
      "An internal tool for our warehouse team to track inventory items (sku, name, quantity, location, reorder level) with search, CSV import and CSV export.",
  },
  {
    label: "Bookings",
    prompt:
      "A booking app for a physiotherapy clinic: therapists set availability, patients book 45-minute slots and get email confirmations.",
  },
  {
    label: "Client portal",
    prompt:
      "A client portal for an accounting firm where clients upload documents and track the status of their tax filing requests.",
  },
];

const KEY = "turbineh:pending-prompt";

export function PromptBox({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const start = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      const res = await fetch("/v1/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ prompt: text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        build_id?: string;
        detail?: string;
        title?: string;
      };
      if (!res.ok || !body.build_id) {
        setError(body.detail ?? body.title ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      sessionStorage.removeItem(KEY);
      router.push(`/build/${body.build_id}`);
    },
    [router],
  );

  // Coming back from GitHub sign-in: resume the prompt the visitor typed before signing in.
  useEffect(() => {
    const saved = sessionStorage.getItem(KEY);
    if (!saved) return;
    // Deferred so the effect itself never sets state synchronously.
    queueMicrotask(() => {
      setPrompt(saved);
      if (signedIn && params.get("resume") === "1" && !started.current) {
        started.current = true;
        void start(saved);
      }
    });
  }, [signedIn, params, start]);

  const valid = prompt.trim().length >= 20;
  async function submit() {
    if (!valid || busy) return;
    if (!signedIn) {
      sessionStorage.setItem(KEY, prompt.trim());
      await authClient.signIn.social({ provider: "github", callbackURL: "/?resume=1" });
      return;
    }
    await start(prompt.trim());
  }

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-line bg-navy-900/70 p-3 shadow-[0_0_80px_-20px_rgba(52,216,196,0.35)] focus-within:border-teal">
        <label htmlFor="prompt" className="sr-only">
          Describe the app you want
        </label>
        <textarea
          id="prompt"
          autoFocus
          rows={4}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="Describe the app you want — users, data, screens…"
          className="w-full resize-none bg-transparent px-3 py-2 text-lg text-ice-2 placeholder:text-muted/70 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <span className="text-xs text-muted">
            {valid ? "⌘ + Enter" : "At least 20 characters"}
          </span>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void submit()}
            className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Starting…" : signedIn ? "Build it" : "Continue with GitHub"}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => setPrompt(ex.prompt)}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-teal hover:text-ice-2"
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

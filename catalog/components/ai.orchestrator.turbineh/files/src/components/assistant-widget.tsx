"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Line = { role: "user" | "assistant" | "error"; text: string };
type Reply = {
  sessionId?: string;
  reply?: string;
  status?: string;
  pending?: { summary: string } | null;
  error?: string;
};

const KEY = "turbineh-assistant-session";

/**
 * Public assistant chat (component ai.orchestrator.turbineh, ADR-0032). Talks to POST /api/assistant; irreversible
 * actions show Confirm / Cancel buttons (typing "yes" or "no" works too). Text only: replies are never rendered
 * as HTML.
 */
export function AssistantWidget({ title, greeting }: { title: string; greeting: string }) {
  const [lines, setLines] = useState<Line[]>([{ role: "assistant", text: greeting }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const session = useRef<string | null>(null);
  const end = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    session.current = window.sessionStorage.getItem(KEY);
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines]);

  async function send(message: string, confirm?: boolean) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setLines((l) => [...l, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.current, message, confirm }),
      });
      const data = (await res.json().catch(() => ({}))) as Reply;
      if (data.sessionId) {
        session.current = data.sessionId;
        window.sessionStorage.setItem(KEY, data.sessionId);
      }
      setPending(Boolean(data.pending));
      setLines((l) => [
        ...l,
        data.reply
          ? { role: "assistant", text: data.reply }
          : { role: "error", text: data.error ?? "Something went wrong. Please try again." },
      ]);
    } catch {
      setLines((l) => [...l, { role: "error", text: "Connection problem. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const m = text;
    setText("");
    void send(m);
  }

  return (
    <section
      aria-label={title}
      className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm"
    >
      <h2 className="font-semibold">{title}</h2>
      <ol data-testid="assistant-log" aria-live="polite" className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm">
        {lines.map((l, i) => (
          <li
            key={i}
            data-role={l.role}
            className={
              l.role === "user"
                ? "self-end whitespace-pre-wrap rounded-md bg-slate-100 px-3 py-2"
                : l.role === "error"
                  ? "whitespace-pre-wrap rounded-md bg-red-50 px-3 py-2 text-red-800"
                  : "whitespace-pre-wrap rounded-md bg-brand/10 px-3 py-2"
            }
          >
            {l.text}
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
      {pending ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("Yes, please go ahead.", true)}
            className="rounded-md bg-brand px-3 py-1 text-sm text-brand-contrast disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("No, don't do it.", false)}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            Don&apos;t do it
          </button>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="assistant-input" className="sr-only">
          Your message
        </label>
        <input
          id="assistant-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          autoComplete="off"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Type your message"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-4 py-2 text-sm text-brand-contrast disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}

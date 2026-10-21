"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EMAIL_PURPOSE, looksLikeEmail } from "@/lib/contact";

/** sessionStorage key: "Later" hides the banner until the browser session ends (it asks again next visit). */
export const CONTACT_LATER_KEY = "tbh_contact_later";

const send = (url: string, method: string, email: string) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

/** One email field with its purpose; pure (state passed in) so it renders the same in tests. */
export function EmailForm({
  label,
  button,
  email,
  busy,
  error,
  testId,
  onEmail,
  onSubmit,
}: {
  label: string;
  button: string;
  email: string;
  busy: boolean;
  error: string | null;
  testId: string;
  onEmail: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      data-testid={testId}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="text-xs text-muted" htmlFor={`${testId}-email`}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${testId}-email`}
          type="email"
          required
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          className="min-w-56 flex-1 rounded-md border border-line bg-navy-900 px-3 py-2 text-sm text-white"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-amber px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          {busy ? "Saving…" : button}
        </button>
      </div>
      <p className="text-xs text-muted">{EMAIL_PURPOSE}</p>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * ADR-0074: a workspace that entered before the access page asked for an email is asked once per visit, without
 * blocking anything. Saved with PUT /v1/contact.
 */
export function ContactBanner() {
  const path = usePathname();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (path === "/access" || path === "/use" || path.startsWith("/ops")) return;
    if (sessionStorage.getItem(CONTACT_LATER_KEY)) return;
    let live = true;
    fetch("/v1/contact")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { email_on_file?: boolean; shared_workspace?: boolean } | null) => {
        if (live && b && !b.email_on_file && !b.shared_workspace) setShow(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);

  if (!show) return null;
  if (saved)
    return (
      <div role="status" className="mx-auto mb-4 max-w-6xl px-6 text-sm text-teal">
        Thanks — we'll email you when something you asked for becomes available.
      </div>
    );
  return (
    <aside
      aria-label="Your email"
      data-testid="contact-banner"
      className="mx-auto mb-6 max-w-6xl px-6"
    >
      <div className="rounded-lg border border-amber/60 p-4">
        <p className="text-sm font-semibold text-cream">Add your email</p>
        <p className="mt-1 text-sm text-ice-2">
          So we can tell you when something you asked for that isn't covered yet becomes available.
        </p>
        <div className="mt-3">
          <EmailForm
            label="Your email"
            button="Save"
            email={email}
            busy={busy}
            error={error}
            testId="contact-banner-form"
            onEmail={setEmail}
            onSubmit={async () => {
              if (!looksLikeEmail(email)) return setError("Enter a valid email address.");
              setBusy(true);
              setError(null);
              const r = await send("/v1/contact", "PUT", email.trim()).catch(() => null);
              setBusy(false);
              if (r?.ok) return setSaved(true);
              setError(
                r?.status === 429
                  ? "Too many changes today. Try again tomorrow."
                  : "It could not be saved. Try again in a moment.",
              );
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(CONTACT_LATER_KEY, "1");
            setShow(false);
          }}
          className="mt-2 text-xs text-muted underline-offset-4 hover:underline"
        >
          Later
        </button>
      </div>
    </aside>
  );
}

/**
 * ADR-0074: on a refused flow without an email on file, "Notify me when it's covered" saves one (POST
 * /v1/builds/{id}/notify) and the priority-list confirmation is emailed.
 */
export function NotifyWhenCovered({ flowId }: { flowId: string }) {
  const [state, setState] = useState<"loading" | "ask" | "on_file" | "saved" | "hidden">("loading");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/v1/builds/${encodeURIComponent(flowId)}/notify`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { demand?: boolean; email_on_file?: boolean } | null) => {
        if (!live) return;
        setState(!b?.demand ? "hidden" : b.email_on_file ? "on_file" : "ask");
      })
      .catch(() => live && setState("hidden"));
    return () => {
      live = false;
    };
  }, [flowId]);

  return (
    <NotifyWhenCoveredView
      state={state}
      email={email}
      busy={busy}
      error={error}
      onEmail={setEmail}
      onSubmit={async () => {
        if (!looksLikeEmail(email)) return setError("Enter a valid email address.");
        setBusy(true);
        setError(null);
        const r = await send(
          `/v1/builds/${encodeURIComponent(flowId)}/notify`,
          "POST",
          email.trim(),
        ).catch(() => null);
        setBusy(false);
        if (r?.ok) return setState("saved");
        setError(
          r?.status === 429
            ? "Too many changes for this request. Try again tomorrow."
            : "It could not be saved. Try again in a moment.",
        );
      }}
    />
  );
}

/** The view of NotifyWhenCovered (pure, for tests). */
export function NotifyWhenCoveredView({
  state,
  email,
  busy,
  error,
  onEmail,
  onSubmit,
}: {
  state: "loading" | "ask" | "on_file" | "saved" | "hidden";
  email: string;
  busy: boolean;
  error: string | null;
  onEmail: (v: string) => void;
  onSubmit: () => void;
}) {
  if (state === "loading" || state === "hidden") return null;
  if (state === "on_file")
    return (
      <p className="mt-3 text-xs text-muted" data-testid="notify-on-file">
        We have your email for this request: we'll tell you when it's covered.
      </p>
    );
  if (state === "saved")
    return (
      <p role="status" className="mt-3 text-sm text-teal" data-testid="notify-saved">
        Done — you're on the priority list. We'll email you when it's covered.
      </p>
    );
  return (
    <div className="mt-3" data-testid="notify-when-covered">
      <EmailForm
        label="Notify me when it's covered"
        button="Notify me"
        email={email}
        busy={busy}
        error={error}
        testId="notify-form"
        onEmail={onEmail}
        onSubmit={onSubmit}
      />
    </div>
  );
}

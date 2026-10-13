"use client";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/**
 * A collapsible section (WAI-ARIA disclosure): a real button with aria-expanded / aria-controls, so Enter and Space
 * toggle it. Closed by default; the URL hash opens it (/use#mcp), on load and on every in-page link to it. The panel
 * stays in the HTML (hidden), so search, copy and the page tests still see its content.
 */
export function Disclosure({
  id,
  eyebrow,
  title,
  summary,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? hash === `#${id}`;

  // A link to this section opens it again, even after it was closed by hand (and even when the hash does not change);
  // a link to another section leaves this one as it was.
  useEffect(() => {
    const target = `#${id}`;
    const onHash = (e: HashChangeEvent) => {
      if (window.location.hash === target) setManual(true);
      else if (new URL(e.oldURL).hash === target) setManual((m) => m ?? true);
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(`a[href="${target}"]`)) setManual(true);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, [id]);

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`scroll-mt-8 rounded-xl border transition-colors ${open ? "border-teal/50 bg-panel/30" : "border-line bg-panel/20 hover:border-teal/40"}`}
    >
      <h3 id={titleId} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setManual(!open)}
          className="flex w-full items-start gap-4 rounded-xl px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          <span className="min-w-0 flex-1">
            <span className="eyebrow block text-teal">{eyebrow}</span>
            <span className="display mt-1 block text-lg font-semibold text-cream">{title}</span>
            <span className="mt-1 block text-sm text-muted">{summary}</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`mt-1 h-5 w-5 shrink-0 text-teal transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="border-t border-line px-5 pb-6">
        {children}
      </div>
    </section>
  );
}

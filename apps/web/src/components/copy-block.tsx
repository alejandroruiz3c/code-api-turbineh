"use client";
import { useState } from "react";

/** A code snippet with a labelled copy button; the result is announced to screen readers. */
export function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="relative mt-3">
      <pre className="prose-doc overflow-auto rounded-xl border border-line bg-navy-900/70 p-4 pr-20 text-[12px] text-ice-2">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
        className="absolute right-2 top-2 rounded-full border border-line bg-navy px-3 py-1 text-xs text-ice-2 hover:border-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied === true ? `${label} copied` : copied === false ? "Copy failed" : ""}
      </span>
    </div>
  );
}

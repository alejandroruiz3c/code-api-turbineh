"use client";
import type { CapabilitySummary } from "@turbineh/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { productApi } from "@/lib/product-api";

/**
 * A component's usage example: code generated from its own contract test (or snippet.ts) and compiled against the
 * pinned versions (ADR-0066), with what and when it compiled. Anything else is shown as plain text, never as code.
 */
export function ComponentExample({ c }: { c: CapabilitySummary }) {
  const check = c.exampleCheck;
  if (!check) return <p className="mt-2 text-[11px] text-muted">{c.example}</p>;
  const caption =
    check.kind === "typescript" && check.compiled
      ? `Snippet compiled against ${check.compiled.against.join(", ") || "Node.js only"} (TypeScript ${check.compiled.typescript}) on ${check.compiled.on} · from ${check.from}`
      : check.kind === "app"
        ? `Compiled inside the assembled apps that include this component · from ${check.from}`
        : check.kind === "json"
          ? `Request parameters, validated against ${check.from}`
          : check.kind === "shell"
            ? "CLI and API calls; every command and route is checked to exist"
            : `From ${check.from} · not compiled yet`;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-teal">Usage example</summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-navy-900/80 p-3 text-[11px] leading-relaxed text-ice-2">
        <code>{c.example}</code>
      </pre>
      <p className="mt-1 text-[10px] text-muted">{caption}</p>
    </details>
  );
}

/** Discover (PLAN §16): search by need → complete use cases and verified components, with what each brings. */
export function Discover({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<CapabilitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void productApi.search(initialQuery).then((r) => {
      if (!alive) return;
      if (r.ok) setResults(r.data);
      else setError(r.error?.action ?? "Search is not available right now. Try again in a moment.");
    });
    return () => {
      alive = false;
    };
  }, [initialQuery]);

  const useCases = results?.filter((r) => r.kind === "use_case") ?? [];
  const components = results?.filter((r) => r.kind === "component") ?? [];

  return (
    <div>
      <form
        role="search"
        className="flex max-w-2xl gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setResults(null);
          router.push(`/discover?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label htmlFor="discover-q" className="sr-only">
          What do you need?
        </label>
        <input
          id="discover-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. support agent, checkout with discount codes, PDF text extraction"
          className="w-full rounded-full border border-line bg-navy-900/80 px-5 py-3 text-sm text-ice-2 placeholder:text-muted focus:border-teal focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-navy"
        >
          Search
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {results === null && !error ? (
        <p className="mt-6 text-sm text-muted" role="status">
          Searching the verified repository…
        </p>
      ) : null}

      {results !== null ? (
        <>
          <section aria-label="Complete use cases" className="mt-10">
            <h2 className="eyebrow">Complete flows · {useCases.length}</h2>
            {useCases.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No complete flow matches yet — the components below can still be integrated into
                your project.
              </p>
            ) : (
              <ul className="mt-4 grid gap-4 md:grid-cols-2">
                {useCases.map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-col rounded-xl border border-line bg-panel/40 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="display text-lg font-semibold text-cream">{u.name}</h3>
                      <span className="rounded-full border border-teal/60 px-2 py-0.5 text-[11px] text-teal">
                        ✓ verified
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ice-2">{u.summary}</p>
                    <dl className="mt-4 grid gap-2 text-xs">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted">Brings</dt>
                        <dd className="text-ice-2">
                          {u.components > 0
                            ? `${u.components} verified components`
                            : "Verified components for every capability"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted">Stack</dt>
                        <dd className="text-ice-2">{u.stacks.join(" · ")}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted">You provide</dt>
                        <dd className="font-mono text-ice-2">
                          {u.requirements.map((r) => r.name).join(", ") || "nothing"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted">Try it</dt>
                        <dd className="text-ice-2">{u.example}</dd>
                      </div>
                    </dl>
                    <div className="mt-5 flex gap-3">
                      <Link
                        href={`/flows/new?capability=${encodeURIComponent(u.id)}&need=${encodeURIComponent(initialQuery || u.example)}`}
                        className="rounded-full bg-amber px-4 py-2 text-sm font-semibold text-navy"
                      >
                        Start a flow
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Components" className="mt-12">
            <h2 className="eyebrow">Verified components · {components.length}</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Each one is contract-tested in an isolated sandbox, licence-checked and scanned for
              known vulnerabilities before it enters the repository. Use them on their own inside
              your project.
            </p>
            <ul className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {components.map((c) => (
                <li key={c.id} className="rounded-lg border border-line px-4 py-3">
                  <p className="font-mono text-xs text-teal">{c.id}</p>
                  <p className="mt-1 text-sm text-ice-2">{c.summary}</p>
                  <ComponentExample c={c} />
                  <Link
                    href={`/flows/new?capability=${encodeURIComponent(c.id)}&need=${encodeURIComponent(c.summary)}`}
                    className="mt-2 inline-block text-xs text-teal underline-offset-4 hover:underline"
                  >
                    Integrate into my project →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

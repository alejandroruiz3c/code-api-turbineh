"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface BuildEvent {
  id: number;
  phase: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

interface BuildResult {
  status: string;
  error: string | null;
  repo_url: string | null;
  metrics: {
    timings?: Record<string, number>;
    reuse?: { reusedShare?: number };
    components?: string[];
    gaps?: { capability: string; trigger: string }[];
  };
  artifact: {
    slug?: string;
    zip_url: string;
    files: string[];
    docs: Record<string, string>;
  } | null;
}

const PHASES: { key: string; label: string; match: string[] }[] = [
  { key: "understand", label: "Understanding your app", match: ["guarding", "compiling"] },
  { key: "select", label: "Selecting components", match: ["selecting"] },
  { key: "resolve", label: "Resolving compatibility", match: ["resolving"] },
  { key: "assemble", label: "Assembling", match: ["assembling"] },
  { key: "verify", label: "Building, testing & scanning", match: ["verifying"] },
  { key: "deliver", label: "Delivering", match: ["delivering"] },
];

const pct = (p: unknown) => `${Math.round(Number(p ?? 0) * 100)}%`;

export function BuildLive({ id }: { id: string }) {
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [result, setResult] = useState<BuildResult | null>(null);

  const loadResult = useCallback(async () => {
    const res = await fetch(`/v1/builds/${id}`);
    if (res.ok) setResult((await res.json()) as BuildResult);
  }, [id]);

  useEffect(() => {
    const es = new EventSource(`/v1/builds/${id}/events`);
    const onEvent = (msg: MessageEvent<string>) => {
      const e = JSON.parse(msg.data) as BuildEvent;
      setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));
    };
    es.addEventListener("phase", onEvent as EventListener);
    es.addEventListener("finished", ((msg: MessageEvent<string>) => {
      onEvent(msg);
      es.close();
      void loadResult();
    }) as EventListener);
    return () => es.close();
  }, [id, loadResult]);

  const finished = events.find((e) => e.type === "finished");
  const phaseState = (match: string[]) => {
    const evs = events.filter((e) => match.includes(e.phase));
    if (evs.some((e) => e.type === "done")) return "done";
    if (evs.length > 0) return finished ? "done" : "running";
    return "pending";
  };
  const by = (phase: string, type = "done") =>
    events.find((e) => e.phase === phase && e.type === type)?.data;
  const selecting = by("selecting") as
    | {
        decisions?: {
          capability: string;
          best: { id: string; p: number } | null;
          trigger: string | null;
        }[];
        decider?: { questions?: number; latencyMs?: number };
      }
    | undefined;
  const verifying = by("verifying") as
    { steps?: { name: string; ok: boolean; ms: number }[] } | undefined;
  const compiling = by("compiling") as
    { decisions?: { recipe?: { choice: string; confidence: number } } } | undefined;

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <ol className="flex flex-col gap-3" aria-label="Build phases">
        {PHASES.map((p) => {
          const s = phaseState(p.match);
          return (
            <li key={p.key} className="flex items-center gap-3 text-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${s === "done" ? "bg-teal" : s === "running" ? "animate-pulse-dot bg-amber" : "bg-line"}`}
                aria-hidden="true"
              />
              <span className={s === "pending" ? "text-muted" : "text-ice-2"}>{p.label}</span>
            </li>
          );
        })}
        {finished ? (
          <li
            className={`mt-2 text-sm font-semibold ${finished.data.status === "done" ? "text-teal" : "text-bad"}`}
            role="status"
          >
            {finished.data.status === "done"
              ? "Verified ✓"
              : `Stopped: ${String(finished.data.reason ?? "verification failed")}`}
          </li>
        ) : null}
      </ol>

      <div className="flex flex-col gap-6">
        {compiling?.decisions?.recipe ? (
          <Panel title="Understood as">
            <p className="text-sm">
              <span className="text-cream">{compiling.decisions.recipe.choice}</span>{" "}
              <span className="text-muted">
                · confidence {pct(compiling.decisions.recipe.confidence)}
              </span>
            </p>
          </Panel>
        ) : null}

        {selecting?.decisions ? (
          <Panel
            title={`Components selected by JEV${selecting.decider?.questions ? ` · ${selecting.decider.questions} decisions in one call` : ""}`}
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {selecting.decisions.map((d) => (
                <li key={d.capability} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <p className="font-mono text-muted">{d.capability}</p>
                  {d.best ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-ice-2">{d.best.id}</span>
                      <span className="ml-auto text-teal">{pct(d.best.p)}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-amber">no catalog component ({d.trigger})</p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {verifying?.steps ? (
          <Panel title="Verification (sandbox, no network)">
            <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {verifying.steps.map((s) => (
                <li
                  key={s.name}
                  className={`rounded-md border px-2 py-1.5 ${s.ok ? "border-teal/50 text-teal" : "border-bad/60 text-bad"}`}
                >
                  {s.ok ? "✓" : "✗"} {s.name}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {result ? <Result id={id} result={result} /> : null}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="animate-fade-up rounded-xl border border-line bg-panel/40 p-5">
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Result({ id, result }: { id: string; result: BuildResult }) {
  const docs = useMemo(() => Object.keys(result.artifact?.docs ?? {}), [result]);
  const [tab, setTab] = useState(docs[0] ?? "README.md");
  if (!result.artifact) {
    return (
      <Panel title="Result">
        <p className="text-sm text-bad">{result.error ?? "The build did not pass verification."}</p>
      </Panel>
    );
  }
  return (
    <>
      <Panel title="Your app">
        <div className="flex flex-wrap items-center gap-3">
          <PushToGitHub id={id} initialUrl={result.repo_url} />
          <a
            href={result.artifact.zip_url}
            className="rounded-full border border-line px-4 py-2 text-sm text-ice-2 hover:border-teal"
          >
            Download .zip
          </a>
          {result.metrics.reuse?.reusedShare !== undefined ? (
            <span className="text-xs text-muted">
              {pct(result.metrics.reuse.reusedShare)} of the code comes from verified components
            </span>
          ) : null}
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Panel title={`Files · ${result.artifact.files.length}`}>
          <ul className="max-h-[480px] overflow-auto font-mono text-xs text-muted">
            {result.artifact.files.map((f) => (
              <li key={f} style={{ paddingLeft: `${(f.split("/").length - 1) * 10}px` }}>
                {f.split("/").pop()}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Documentation">
          <div role="tablist" className="mb-3 flex flex-wrap gap-2">
            {docs.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={tab === d}
                onClick={() => setTab(d)}
                className={`rounded-full px-3 py-1 text-xs ${tab === d ? "bg-teal text-navy" : "border border-line text-muted"}`}
              >
                {d.replace(".md", "")}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="prose-doc max-h-[480px] overflow-auto text-ice-2">
            {(result.artifact.docs[tab] ?? "").replace(/^<!-- turbineh:generated -->\n/, "")}
          </div>
        </Panel>
      </div>
    </>
  );
}

function PushToGitHub({ id, initialUrl }: { id: string; initialUrl: string | null }) {
  const params = useSearchParams();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">(
    initialUrl ? "done" : "idle",
  );
  const [url, setUrl] = useState(initialUrl);
  const [message, setMessage] = useState<string | null>(null);

  const push = useCallback(async () => {
    setState("working");
    const res = await fetch(`/v1/builds/${id}/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.status === 409) {
      const body = (await res.json()) as { needs_scope?: string };
      if (body.needs_scope) {
        // Ask GitHub for the `repo` permission only now, then come back and continue automatically.
        await authClient.linkSocial({
          provider: "github",
          scopes: ["repo"],
          callbackURL: `/build/${id}?push=1`,
        });
        return;
      }
    }
    if (!res.ok) {
      setState("error");
      setMessage("Could not start the push. Please try again.");
      return;
    }
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = (await (await fetch(`/v1/builds/${id}/deliver`)).json()) as {
        delivery: { status: string; repo_url: string | null; error: string | null } | null;
      };
      if (s.delivery?.status === "done" && s.delivery.repo_url) {
        setUrl(s.delivery.repo_url);
        setState("done");
        return;
      }
      if (s.delivery?.status === "failed") {
        setState("error");
        setMessage(s.delivery.error ?? "Push failed");
        return;
      }
    }
  }, [id]);

  useEffect(() => {
    if (params.get("push") === "1" && state === "idle") queueMicrotask(() => void push());
  }, [params, push, state]);

  if (state === "done" && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy"
      >
        Open on GitHub ↗
      </a>
    );
  }
  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        disabled={state === "working"}
        onClick={() => void push()}
        className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy disabled:opacity-50"
      >
        {state === "working" ? "Pushing…" : "Push to my GitHub"}
      </button>
      {message ? <span className="text-xs text-bad">{message}</span> : null}
    </span>
  );
}

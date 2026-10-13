"use client";
import type { FlowResult, Plan } from "@turbineh/shared";
import { useEffect, useState } from "react";
import { AGENT_INSTRUCTIONS, productApi } from "@/lib/product-api";
import { RepoIntegration } from "./repo-integration";
import { Panel, StateBadge, Stat, pct, secs } from "./ui";

type Flow = Plan & { result?: FlowResult | null };

/** A flow run by the product engine (PLAN §16.4): polls the plan until it has a result. */
export function EngineFlow({ id }: { id: string }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await productApi.flow(id);
      if (!alive) return;
      if (!r.ok) return setError(r.error?.action ?? "This flow could not be loaded.");
      setFlow(r.data);
      const done =
        r.data.result && !["planning", "generating", "planned"].includes(r.data.result.state);
      if (!done) timer = setTimeout(() => void tick(), 2500);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error)
    return (
      <p role="alert" className="text-sm text-bad">
        {error}
      </p>
    );
  if (!flow)
    return (
      <p className="text-sm text-muted" role="status">
        Loading the flow…
      </p>
    );
  const r = flow.result;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <StateBadge state={r?.state ?? flow.state} />
        <span className="text-sm text-muted">{flow.capability.name}</span>
      </div>
      <Panel title={`Decisions · ${flow.decisions.length}`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {flow.decisions.map((d) => (
            <li key={d.topic} className="rounded-lg border border-line px-3 py-2 text-xs">
              <p className="font-mono text-muted">{d.topic}</p>
              <p className="mt-1 text-ice-2">{d.choice}</p>
              <p className="mt-1 text-muted">{d.why}</p>
            </li>
          ))}
        </ul>
      </Panel>
      {r ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="What works">
              <ul className="flex flex-col gap-2 text-sm">
                {r.works.map((w) => (
                  <li key={w}>
                    <span className="text-teal">✓</span> {w}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Needs your configuration">
              {r.needs.filter((n) => !n.satisfied).length === 0 ? (
                <p className="text-sm text-teal">Nothing pending.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {r.needs
                    .filter((n) => !n.satisfied)
                    .map((n) => (
                      <li key={n.name}>
                        <span className="text-amber">○</span>{" "}
                        <span className="font-mono">{n.name}</span>
                        <span className="block text-xs text-muted">{n.why}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat value={secs(r.metrics.seconds)} label="Time to this state" accent />
            <Stat value={pct(r.metrics.reusedShare)} label="Reused from verified components" />
            <Stat value={String(r.metrics.newLines)} label="New lines to maintain" />
            <Stat value={String(r.metrics.securityFindings)} label="Open security findings" />
          </div>
          <div className="flex flex-wrap gap-3">
            {r.try ? (
              <span className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy">
                Try: <code>{r.try.command}</code>
              </span>
            ) : null}
            {r.package.zipUrl ? (
              <a
                href={r.package.zipUrl}
                className="rounded-full border border-teal px-5 py-2 text-sm text-teal"
              >
                Download ZIP
              </a>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(r.agentInstructions || AGENT_INSTRUCTIONS)
                  .then(() => setCopied(true))
              }
              className="rounded-full border border-line px-5 py-2 text-sm text-ice-2"
            >
              {copied ? "Copied ✓" : "Copy instructions for your AI agent"}
            </button>
          </div>
          <Panel title="Checks">
            <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {r.checks.map((c) => (
                <li
                  key={c.name}
                  className={`rounded-md border px-2 py-1.5 ${c.ok ? "border-teal/50 text-teal" : "border-bad/60 text-bad"}`}
                >
                  {c.ok ? "✓" : "✗"} {c.name}
                </li>
              ))}
            </ul>
          </Panel>
          {r.errors.map((e) => (
            <div key={e.code} role="alert" className="rounded-lg border border-bad/60 p-4 text-sm">
              <p className="text-bad">{e.message}</p>
              <p className="mt-1 text-ice-2">→ {e.action}</p>
              {e.resume ? <code className="mt-1 block text-xs text-teal">{e.resume}</code> : null}
            </div>
          ))}
          {["verified", "generated", "integrated", "integration_verified"].includes(r.state) ? (
            <div id="integrate">
              <RepoIntegration planId={id} defaultRepo={flow.repository?.repo} />
            </div>
          ) : null}
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Continue">
              <p className="prose-doc text-ice-2">{r.continue}</p>
            </Panel>
            <Panel title="Revert">
              <p className="prose-doc text-ice-2">{r.revert}</p>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";

interface Summary {
  active: { prefix: string; createdAt: string; dailyTokenQuota: number } | null;
  last30d: { calls: number; inputTokens: number; outputTokens: number };
  today: { calls: number; tokens: number };
  /** Trial of the TurbineH orchestration for this account, across all its AI apps (null = no cap). */
  trial?: {
    spentUsd: number;
    capUsd: number;
    remainingUsd: number;
    reached: boolean;
    contact: string;
  } | null;
}

const fmt = (n: number) => n.toLocaleString("en");
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * AI access for apps built with the orchestrator (ADR-0029): the app uses TurbineH's AI through a per-app token, so the
 * client configures no AI keys. The token is shown once; usage is shown in calls and tokens.
 */
export function AiAccess({ id }: { id: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [token, setToken] = useState<{ token: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/v1/builds/${id}/ai-token`);
    if (res.ok) setSummary((await res.json()) as Summary);
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function create() {
    setError(null);
    const res = await fetch(`/v1/builds/${id}/ai-token`, { method: "POST", headers: { "Content-Type": "application/json" } });
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      url?: string;
      title?: string;
    };
    if (!res.ok || !body.token) return setError(body.title ?? "Could not create the token.");
    setToken({ token: body.token, url: body.url ?? "" });
    setCopied(false);
    await load();
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        This app reaches a model in one of two ways, by configuration only: the{" "}
        <strong>TurbineH gateway</strong> — set <code className="text-teal">TURBINEH_AI_TOKEN</code>{" "}
        (Deploy for me does it for you) — or <strong>your own OpenAI-compatible provider</strong> —
        leave the token empty and set <code className="text-teal">AI_BASE_URL</code>,{" "}
        <code className="text-teal">AI_API_KEY</code> and{" "}
        <code className="text-teal">AI_MODEL</code>. DEPLOY.md explains both and what happens when
        the endpoint is unavailable.
      </p>
      {token ? (
        <div className="rounded-lg border border-amber/60 p-3">
          <p className="text-xs text-amber">Copy it now — it is shown only once.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-navy-900 px-2 py-1 text-xs text-ice-2">
              {token.token}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(token.token);
                setCopied(true);
              }}
              className="rounded-full border border-line px-3 py-1 text-xs hover:border-teal"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {token.url ? (
            <p className="mt-2 text-xs text-muted">
              <code>TURBINEH_AI_URL={token.url}</code>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void create()}
          className="rounded-full border border-teal/70 px-4 py-2 text-teal hover:bg-teal/10"
        >
          {summary?.active ? "Rotate AI access token" : "Get AI access token"}
        </button>
        {summary?.active ? (
          <span className="text-xs text-muted">
            Active: <code>{summary.active.prefix}…</code> · today {fmt(summary.today.calls)} calls,{" "}
            {fmt(summary.today.tokens)} / {fmt(summary.active.dailyTokenQuota)} tokens · last 30
            days {fmt(summary.last30d.calls)} calls
          </span>
        ) : null}
      </div>
      {summary?.trial ? (
        summary.trial.reached ? (
          <p role="status" data-testid="ai-trial" className="text-amber">
            You&apos;ve reached the trial limit of the TurbineH orchestration (
            {usd(summary.trial.capUsd)}) for all your AI apps. Contact{" "}
            <a
              className="underline"
              href={`mailto:${summary.trial.contact}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {summary.trial.contact}
            </a>{" "}
            to continue.
          </p>
        ) : (
          <p data-testid="ai-trial" className="text-xs text-muted">
            Trial balance: {usd(summary.trial.remainingUsd)} of {usd(summary.trial.capUsd)} left for
            all your AI apps.
          </p>
        )
      ) : null}
      {error ? (
        <p role="alert" className="text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

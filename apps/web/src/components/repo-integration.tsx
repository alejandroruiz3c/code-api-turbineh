"use client";
import { useCallback, useEffect, useState } from "react";
import { productApi, type RepoIntegration as Job } from "@/lib/product-api";
import { GithubConnect, RepoPicker, useGithub } from "./github-connect";
import { Panel } from "./ui";

const PHASES: [string, string][] = [
  ["analysing", "Analysing your repository"],
  ["adapting", "Adapting to your conventions"],
  ["preparing", "Lockfile and migration with your tools"],
  ["committing", "Commits and pull request"],
  ["verifying", "Verifying inside your project"],
];

/**
 * "Integrate into repository" (PLAN §16 P5): connect GitHub if needed, pick the repository, then follow the job until
 * the pull request is verified (ready for review) or stays a draft with exact failures.
 */
export function RepoIntegration({ planId, defaultRepo }: { planId: string; defaultRepo?: string }) {
  const { status, reload } = useGithub();
  const [repo, setRepo] = useState(defaultRepo ?? "");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = `/flows/${planId}?integrate=1#integrate`;

  // Plans made from a connected repository integrate there by default.
  useEffect(() => {
    if (defaultRepo) return;
    void productApi.flow(planId).then((r) => {
      const fromPlan = r.ok ? r.data.repository?.repo : undefined;
      if (fromPlan) setRepo((cur) => cur || fromPlan);
    });
  }, [planId, defaultRepo]);

  const poll = useCallback(async () => {
    const r = await productApi.integrations(planId);
    if (r.ok) setJob(r.data.integrations[0] ?? null);
    return r.ok ? r.data.integrations[0] : undefined;
  }, [planId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const tick = async () => {
      const j = await poll();
      if (alive && j && (j.status === "queued" || j.status === "running"))
        timer = setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [poll, busy]);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await productApi.pullRequest(planId, repo);
    if (r.ok) setJob(r.data.integration);
    else setError(r.error ? `${r.error.message} → ${r.error.action}` : "It could not start.");
    setBusy(false);
  }

  const running = job && (job.status === "queued" || job.status === "running");
  const verified = job?.state === "integration_verified";
  const checks = job?.result.checks ?? [];
  return (
    <Panel title="Integrate into your repository">
      {!job || job.status === "failed" ? (
        <div className="flex flex-col gap-4">
          <GithubConnect status={status} returnTo={returnTo} onChange={() => void reload()} />
          {status?.connected ? (
            <>
              <RepoPicker value={repo} onPick={setRepo} />
              <p className="text-xs text-muted">
                TurbineH adapts the package to the repository&apos;s conventions, commits each step
                on a new <code>turbineh/…</code> branch, opens a pull request and verifies it inside
                your project. It is marked ready for review only when every check passes; nothing is
                merged.
              </p>
              <button
                type="button"
                disabled={!repo || busy}
                onClick={() => void start()}
                className="self-start rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy disabled:opacity-40"
              >
                {busy ? "Starting…" : repo ? `Open a pull request on ${repo}` : "Pick a repository"}
              </button>
            </>
          ) : null}
          {job?.status === "failed" && job.error ? (
            <div role="alert" className="rounded-lg border border-bad/60 p-3 text-sm">
              <p className="text-bad">{job.error.message}</p>
              <p className="mt-1 text-ice-2">→ {job.error.action}</p>
            </div>
          ) : null}
          {error ? <p className="text-sm text-bad">{error}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
          <p className="text-sm text-ice-2">
            <span className="font-mono">{job.repo}</span>
            {job.branch ? (
              <>
                {" "}
                · branch <span className="font-mono">{job.branch}</span>
              </>
            ) : null}
          </p>
          {running ? (
            <ol className="flex flex-col gap-2 text-sm">
              {PHASES.map(([key, label], i) => {
                const at = PHASES.findIndex(([k]) => k === job.phase);
                const s = i < at ? "done" : i === at ? "running" : "pending";
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 rounded-full ${s === "done" ? "bg-teal" : s === "running" ? "animate-pulse-dot bg-amber" : "bg-line"}`}
                    />
                    <span className={s === "pending" ? "text-muted" : "text-ice-2"}>{label}</span>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {job.pull_request ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={job.pull_request.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy"
              >
                Open pull request #{job.pull_request.number} ↗
              </a>
              <span
                className={`rounded-full border px-3 py-1 text-xs ${verified ? "border-teal text-teal" : running ? "border-amber/60 text-amber" : "border-bad/60 text-bad"}`}
              >
                {verified
                  ? "Verified in your project · ready for review"
                  : running
                    ? "Draft · verification running"
                    : "Draft · not verified yet"}
              </span>
            </div>
          ) : null}
          {!running && checks.length ? (
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {checks.map((c) => (
                <li key={c.name} className={c.ok === false ? "text-bad" : "text-teal"}>
                  {c.ok === false ? "✗" : c.ok === null ? "–" : "✓"} {c.name}
                  {c.ok === false ? (
                    <span className="block text-ice-2">
                      {c.detail}
                      {c.action ? <span className="block text-muted">→ {c.action}</span> : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {!running && job.result.reviewerSetup?.length ? (
            <div className="text-xs">
              <p className="text-cream">What you configure before merging</p>
              <ul className="mt-1 list-disc pl-5 text-ice-2">
                {job.result.reviewerSetup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!running ? (
            <button
              type="button"
              onClick={() => setJob(null)}
              className="self-start text-xs text-muted underline"
            >
              Integrate into another repository
            </button>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

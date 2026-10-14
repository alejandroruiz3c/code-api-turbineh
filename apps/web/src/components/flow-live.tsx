import type { FlowOutcome, Plan } from "@turbineh/shared";
import { about, duration, type Progress } from "@/lib/flow-progress";
import { RepoIntegration } from "./repo-integration";
import { Panel } from "./ui";

/** After this long without any event the page says so and offers a safe action (ADR-0051). */
export const QUIET_NOTICE_MS = 20_000;

/**
 * The live part of a flow (ADR-0051): what is happening now in plain words, the elapsed time, how long this step
 * usually takes, the steps done / current / next, and a reassuring line when nothing has happened for a while. Pure
 * (no hooks) so it renders the same in the page and in tests. Never a spinner without text.
 */
export function LiveNow({
  progress,
  connection,
}: {
  progress: Progress;
  connection: "connecting" | "live" | "reconnecting" | "closed" | "polling";
}) {
  const cur = progress.current;
  const quiet = progress.quietMs >= QUIET_NOTICE_MS;
  return (
    <Panel title="Now">
      <div aria-live="polite" data-testid="flow-now">
        <p className="flex items-start gap-3 text-base text-cream">
          <span
            aria-hidden="true"
            className="mt-2 h-2.5 w-2.5 shrink-0 animate-pulse-dot rounded-full bg-amber"
          />
          <span>
            {cur ? cur.line : "Starting: connecting to the live trace"}
            {cur ? "…" : ""}
          </span>
        </p>
        {cur && cur.details.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 pl-6 font-mono text-xs text-ice-2">
            {cur.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 pl-6 text-xs text-muted">
          Elapsed {duration(progress.elapsedMs)}
          {cur && progress.typicalMs !== null
            ? ` · this step usually takes ${about(progress.typicalMs)}`
            : ""}
          {progress.next ? ` · next: ${progress.next}` : ""}
        </p>
        {connection === "reconnecting" ? (
          <p className="mt-2 pl-6 text-xs text-amber">
            The live connection dropped: reconnecting. The flow keeps running on our side.
          </p>
        ) : null}
        {quiet ? (
          <div className="mt-4 rounded-lg border border-line p-3 text-sm" role="status">
            <p className="text-ice-2">
              Still running {cur ? cur.label.toLowerCase() : "the flow"}… nothing new for{" "}
              {duration(progress.quietMs)}
              {progress.typicalMs !== null
                ? `; this step usually takes ${about(progress.typicalMs)}`
                : ""}
              .
            </p>
            <p className="mt-1 text-xs text-muted">
              Keep this page open or come back later: we&rsquo;ll keep building. We check its state
              every few seconds and show the result as soon as it is there.{" "}
              <a href="/activity" className="text-teal underline">
                Activity
              </a>{" "}
              lists every flow with its state.
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

const DOT: Record<string, string> = {
  done: "bg-teal",
  current: "animate-pulse-dot bg-amber",
  next: "border border-amber bg-transparent",
  pending: "bg-line",
  skipped: "bg-line",
};
const WORD: Record<string, string> = {
  done: "done",
  current: "now",
  next: "next",
  pending: "later",
  skipped: "skipped",
};

/** Steps of the latest run: done / now / next / later, each with its word (not only a colour). */
export function FlowSteps({ progress }: { progress: Progress }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Flow trace">
      {progress.steps.map((s) => (
        <li key={s.key} className="flex items-center gap-3 text-sm" data-status={s.status}>
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[s.status]}`}
          />
          <span
            className={
              s.status === "pending" || s.status === "skipped" ? "text-muted" : "text-ice-2"
            }
          >
            {s.label}
            {s.note ? <span className="block text-[11px] text-muted">{s.note}</span> : null}
          </span>
          <span
            className={`ml-auto text-[11px] ${s.status === "current" ? "text-amber" : s.status === "done" ? "text-teal" : "text-muted"}`}
          >
            {WORD[s.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A capability package for an existing project (ADR-0051): verified in the sandbox or "ready, not verified yet",
 * with the three ways to use it and what is left. Text comes from `outcome` (the API's, same as the CLI).
 */
export function PackageResult({
  id,
  outcome,
  zipUrl,
  plan,
}: {
  id: string;
  outcome: FlowOutcome;
  zipUrl: string | null;
  plan: Plan | null;
}) {
  const action = (k: string) => outcome.actions.find((a) => a.id === k);
  const pr = action("open_pull_request");
  const zip = action("download_zip");
  const cli = action("apply_cli");
  const verified = outcome.kind === "package_verified";
  return (
    <>
      <Panel title="Result">
        <div role="status" data-testid="flow-outcome">
          <p className={`text-lg font-semibold ${verified ? "text-teal" : "text-cream"}`}>
            {outcome.title}
          </p>
          <p className="mt-2 text-sm text-ice-2">{outcome.meaning}</p>
          {outcome.verification ? (
            <p className="mt-2 text-xs text-muted">What was checked: {outcome.verification}</p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {pr ? (
            <a
              href="#integrate"
              title={pr.detail}
              className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy"
            >
              {pr.label}
            </a>
          ) : null}
          {zip && zipUrl ? (
            <a
              href={zipUrl}
              title={zip.detail}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-teal px-5 py-2 text-sm text-teal hover:bg-teal/10"
            >
              {zip.label}
            </a>
          ) : null}
        </div>
        <ul className="mt-4 flex flex-col gap-3 text-sm text-ice-2">
          {pr ? (
            <li>
              <span className="text-cream">{pr.label}:</span> {pr.detail}
            </li>
          ) : null}
          {zip ? (
            <li>
              <span className="text-cream">{zip.label}:</span> {zip.detail}
            </li>
          ) : null}
          {cli ? (
            <li>
              <span className="text-cream">From your terminal:</span>{" "}
              <code className="text-teal">{cli.command ?? cli.label}</code>
              <span className="mt-1 block text-xs text-muted">What it does: {cli.detail}</span>
            </li>
          ) : null}
        </ul>
        {outcome.left.length > 0 ? (
          <div className="mt-5">
            <p className="text-sm font-semibold text-cream">What is left</p>
            <ol className="mt-2 list-decimal pl-5 text-sm text-ice-2">
              {outcome.left.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {plan && plan.components.length > 0 ? (
          <p className="mt-4 text-xs text-muted">
            Components:{" "}
            {plan.components.map((c) => (
              <code key={c.id} className="mr-2 text-ice-2">
                {c.id}@{c.version}
              </code>
            ))}
          </p>
        ) : null}
      </Panel>
      <div id="integrate" className="scroll-mt-24">
        <RepoIntegration planId={id} defaultRepo={plan?.repository?.repo} />
      </div>
    </>
  );
}

/** Any other end state without a package on this page: never a blank page. */
export function FlowFinished({ id, outcome }: { id: string; outcome: FlowOutcome | null }) {
  return (
    <Panel title="Result">
      <div role="status" data-testid="flow-outcome">
        <p className="text-lg font-semibold text-cream">{outcome?.title ?? "The flow finished"}</p>
        <p className="mt-2 text-sm text-ice-2">
          {outcome?.meaning ??
            "It ended without a package on this page. Its full state is in Activity and at the API."}
        </p>
        <p className="mt-3 text-xs text-muted">
          <a href="/activity" className="text-teal underline">
            Activity
          </a>{" "}
          · <code className="text-ice-2">turbineh status {id}</code>
        </p>
      </div>
    </Panel>
  );
}

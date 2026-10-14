"use client";
import type { FlowOutcome, FlowState, Plan } from "@turbineh/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentRun, isWorking } from "@/lib/flow-events";
import { followFlow, type FollowSnapshot } from "@/lib/flow-follow";
import { describeProgress, duration, type RunKind } from "@/lib/flow-progress";
import { FlowFinished, FlowSteps, LiveNow, PackageResult } from "./flow-live";
import { AGENT_INSTRUCTIONS, productApi } from "@/lib/product-api";
import { AiAccess } from "./ai-access";
import { DeployForMe } from "./deploy-for-me";
import { RepoIntegration } from "./repo-integration";
import { Panel, StateBadge, Stat, pct } from "./ui";

interface BuildReport {
  headline: string;
  overview: string;
  criteria: { criterion: string; evidence: string; verified: boolean }[];
  security: {
    status: "clear" | "alerts";
    statusLine: string;
    points: string[];
    fixedBeforeDelivery: number;
  };
  nextSteps: string[];
  improvement: ImprovementEstimate | null;
}

interface ImprovementEstimate {
  total: number;
  fixable: number;
  fixableProduction: number;
  minutes: { min: number; max: number };
}

/** One failing check of a delivered, not verified package (ADR-0037 §D1). */
interface DeliveryFailure {
  step: string;
  test: string | null;
  where: string;
  owner: string | null;
  message: string;
  rerun: string;
  fix: string;
}

/** What happened, why, what to do and the next action (ADR-0050, engine `explainFailure`). */
interface FlowProblem {
  code: string;
  title: string;
  why: string;
  action: string;
  resume?: string;
  next: { label: string; kind: "generate_again" | "new_flow" | "open_package" | "wait" };
}

export interface BuildResult {
  status: string;
  /** The same state as /v1/plans/{id} and the CLI (ADR-0051). */
  state?: FlowState;
  /** The end state in plain words with its next actions (ADR-0051). */
  outcome?: FlowOutcome | null;
  /** The capability package (component-only flows deliver only this). */
  package?: { slug: string | null; zip_url: string; manifest_url: string | null } | null;
  prompt?: string;
  error: string | null;
  problem?: FlowProblem | null;
  /** True only when every check passed (ADR-0037). */
  verified?: boolean | null;
  delivery?: {
    kind: "verified" | "unverified" | "report_only";
    label: string;
    checks_passed: number;
    checks_total: number;
    failures: DeliveryFailure[];
  } | null;
  repo_url: string | null;
  improvement_build_id: string | null;
  metrics: {
    plan?: Plan;
    reuse?: { reusedShare?: number; reusedLines?: number; generatedLines?: number };
    components?: (string | { id?: string })[];
    alerts?: { id: string; level: string; title: string; explain: string; where: string }[];
    report?: BuildReport;
    improved?: boolean;
    handover?: { checksPassed?: number; checksTotal?: number; fixedBeforeDelivery?: number };
    deployment?: { url?: string } | null;
    timings?: Record<string, number>;
  };
  artifact: {
    slug?: string;
    zip_url: string | null;
    files: string[];
    docs: Record<string, string>;
    report_only?: boolean;
  } | null;
}

/** A failed gate that still delivered its package (never presented as verified). */
const notVerified = (r: BuildResult) =>
  r.status === "failed" && r.delivery?.kind === "unverified" && Boolean(r.artifact?.zip_url);

type Tab = "try" | "review" | "check" | "continue" | "revert";
const TABS: { key: Tab; label: string }[] = [
  { key: "try", label: "Try" },
  { key: "review", label: "Review" },
  { key: "check", label: "Check" },
  { key: "continue", label: "Continue" },
  { key: "revert", label: "Revert" },
];

const ENV_NAME = /`([A-Z][A-Z0-9_]{2,})`/g;
const SECRETLESS_DEFAULTS = new Set(["NODE_ENV", "PORT"]);

export function FlowView({ id }: { id: string }) {
  const [snap, setSnap] = useState<FollowSnapshot<BuildResult>>(() => ({
    events: [],
    result: null,
    connection: "connecting",
    lastEventAt: Date.now(),
  }));
  const [now, setNow] = useState(() => Date.now());
  const [typical, setTypical] = useState<Partial<Record<RunKind, Record<string, number>>>>({});
  const follower = useRef<ReturnType<typeof followFlow> | null>(null);

  useEffect(() => {
    // ADR-0051: the row first (late subscriber), live events, reconnects, and a safety net that polls the API when
    // nothing arrives — the page always reaches an end state.
    const f = followFlow<BuildResult>(id, {
      open: (url) => new EventSource(url),
      load: async () => {
        const res = await fetch(`/v1/builds/${id}`, { cache: "no-store" });
        return res.ok ? ((await res.json()) as BuildResult) : null;
      },
      onChange: (s) => {
        setSnap(s);
        setNow(Date.now());
      },
    });
    follower.current = f;
    return () => f.stop();
  }, [id]);

  useEffect(() => {
    void fetch("/v1/activity/timings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((t: Partial<Record<RunKind, Record<string, number>>>) => setTypical(t))
      .catch(() => undefined);
  }, []);

  const { events, result } = snap;
  const restart = useCallback(() => follower.current?.restart(), []);
  const terminal = Boolean(result && !isWorking(result.status));
  const kind: RunKind =
    result?.metrics.plan?.capability?.kind === "component" ||
    events.some((e) => e.phase === "assembling" && e.data.package === "components")
      ? "component"
      : "app";
  const progress = describeProgress(events, {
    kind,
    now,
    typical: typical[kind] ?? {},
    finished: terminal,
  });

  // One row carries the plan run and then the generation run: show the latest run only.
  const run = currentRun(events);
  const by = (phase: string, type = "done") =>
    run.find((e) => e.phase === phase && e.type === type)?.data;
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
  const verifying = run.filter((e) => e.phase === "verifying" && e.type === "done").at(-1)?.data as
    { steps?: { name: string; ok: boolean; ms: number }[]; package?: string } | undefined;
  const compiling = by("compiling") as
    { decisions?: { recipe?: { choice: string; confidence: number } } } | undefined;
  const scope = by("compiling", "scope") as { builtOn?: string } | undefined;

  // The API's state (same as /v1/plans and the CLI); before the row is loaded, "generating".
  const state: FlowState =
    terminal && result
      ? (result.state ??
        (result.status === "done"
          ? result.metrics.deployment
            ? "deployed"
            : "verified"
          : notVerified(result)
            ? "generated"
            : "failed"))
      : "generating";
  const outcome = terminal ? (result?.outcome ?? null) : null;
  const packageOnly =
    terminal &&
    result?.status === "done" &&
    !result.artifact?.zip_url &&
    (outcome?.kind === "package_verified" ||
      outcome?.kind === "package_unverified" ||
      Boolean(result.package?.zip_url));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
        <StateBadge
          state={state}
          {...(outcome?.kind === "package_unverified"
            ? { label: "Package ready · not verified yet", hint: outcome.title }
            : outcome?.kind === "package_verified"
              ? { label: "Package verified", hint: outcome.title }
              : {})}
        />
        <span className="text-sm text-muted">
          {terminal
            ? `Finished${progress.elapsedMs > 0 ? ` in ${duration(progress.elapsedMs)}` : ""}.`
            : `Live · ${duration(progress.elapsedMs)} so far — every step appears below as it happens.`}
        </span>
      </div>

      {!terminal ? <LiveNow progress={progress} connection={snap.connection} /> : null}

      {result && notVerified(result) && result.delivery ? (
        <NotVerifiedPanel delivery={result.delivery} />
      ) : null}
      {terminal && result?.artifact?.zip_url ? (
        <ResultScreen id={id} result={result} onReload={restart} />
      ) : null}
      {packageOnly && result && outcome ? (
        <PackageResult
          id={id}
          outcome={outcome}
          zipUrl={result.package?.zip_url ?? null}
          plan={(result.metrics.plan as Plan | undefined) ?? null}
        />
      ) : null}
      {terminal && result && result.status === "failed" && !result.artifact?.zip_url ? (
        <WhatHappened id={id} result={result} onRetry={restart} />
      ) : null}
      {terminal && result?.status === "done" && !result.artifact?.zip_url && !packageOnly ? (
        <FlowFinished id={id} outcome={outcome} />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <FlowSteps progress={progress} />

        <div className="flex flex-col gap-6">
          {compiling?.decisions?.recipe ? (
            <Panel title="Intent understood">
              {scope?.builtOn ? (
                <p className="text-sm text-ice-2">
                  No ready-made template matched your need exactly, so it is built on the closest
                  one: <span className="text-cream">{scope.builtOn}</span>. What it does not cover
                  is listed in AGENTS.md (&ldquo;What is left&rdquo;) with where to implement it.
                </p>
              ) : (
                <p className="text-sm">
                  <span className="text-cream">{compiling.decisions.recipe.choice}</span>{" "}
                  <span className="text-muted">
                    · confidence {pct(compiling.decisions.recipe.confidence)}
                  </span>
                </p>
              )}
            </Panel>
          ) : null}
          {selecting?.decisions ? (
            <Panel
              title={`Decisions · ${selecting.decisions.length} capabilities${selecting.decider?.questions ? ` · ${selecting.decider.questions} questions decided in one pass` : ""}`}
            >
              <ul className="grid gap-2 sm:grid-cols-2">
                {selecting.decisions.map((d) => (
                  <li
                    key={d.capability}
                    className="rounded-lg border border-line px-3 py-2 text-xs"
                  >
                    <p className="font-mono text-muted">{d.capability}</p>
                    {d.best ? (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-ice-2">{d.best.id}</span>
                        <span className="ml-auto text-teal">{pct(d.best.p)} fit</span>
                      </div>
                    ) : (
                      <p className="mt-1 text-amber">
                        no verified component yet — written and verified as glue
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {verifying?.steps ? (
            <Panel
              title={
                verifying.package
                  ? "Verification · contract tests in an isolated sandbox"
                  : "Verification · isolated sandbox, no network"
              }
            >
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
        </div>
      </div>
    </div>
  );
}

/**
 * A flow that stopped without a package: what happened, why, what to do and one button for the next step
 * (ADR-0050). The raw reason stays under "Details for support".
 */
function WhatHappened({
  id,
  result,
  onRetry,
}: {
  id: string;
  result: BuildResult;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = result.problem;
  const title = p?.title ?? "The app could not be generated";
  const why = p?.why ?? result.error ?? "A step failed without a reason we could show.";
  const action = p?.action ?? "Start the flow again with the same description.";
  const next = p?.next ?? { label: "Start the flow again", kind: "new_flow" as const };
  const retry = next.kind === "generate_again";
  const need = encodeURIComponent((result.prompt ?? "").slice(0, 2000));
  async function generateAgain() {
    setBusy(true);
    setError(null);
    const r = await productApi.generate(id);
    setBusy(false);
    if (r.ok) return onRetry();
    setError(r.error ? `${r.error.message} → ${r.error.action}` : "It could not start.");
  }
  return (
    <Panel title="What happened">
      <div role="alert">
        <p className="text-base font-semibold text-cream">{title}</p>
        <p className="mt-2 text-sm text-ice-2">{why}</p>
        <p className="mt-3 text-sm text-ice-2">
          <span className="text-muted">What to do:</span> {action}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {retry ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void generateAgain()}
            className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy disabled:opacity-50"
          >
            {busy ? "Starting…" : next.label}
          </button>
        ) : null}
        <a
          href={`/flows/new?need=${need}`}
          className={
            retry
              ? "rounded-full border border-line px-5 py-2 text-sm text-ice-2 hover:border-teal"
              : "rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy"
          }
        >
          {retry ? "Start a new flow" : next.label}
        </a>
      </div>
      {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
      {result.error ? (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer">Details for support</summary>
          <p className="mt-1 font-mono">{result.error}</p>
          {p?.resume ? <p className="mt-1 font-mono">{p.resume}</p> : null}
        </details>
      ) : null}
    </Panel>
  );
}

/** "Delivered, not verified: N/M": the exact failures and the suggested fix, before anything else (ADR-0037). */
function NotVerifiedPanel({ delivery }: { delivery: NonNullable<BuildResult["delivery"]> }) {
  return (
    <Panel title={delivery.label}>
      <p className="text-sm text-ice-2">
        The package is delivered so you or your coding agent can continue, but the TurbineH gate did
        not pass: it is <strong className="text-bad">not verified</strong>. Fix the failure below
        first — AGENTS.md and turbineh.json in the package say the same.
      </p>
      <ul className="mt-3 flex flex-col gap-3 text-sm">
        {delivery.failures.map((f) => (
          <li
            key={`${f.step}-${f.where}-${f.test ?? ""}`}
            className="rounded-lg border border-bad/50 p-3"
          >
            <p className="text-bad">
              ✗ {f.step}
              {f.test ? ` · ${f.test}` : ""}
            </p>
            <p className="mt-1 font-mono text-xs text-ice-2">
              {f.where}
              {f.owner ? ` · ${f.owner}` : ""}
            </p>
            {f.message ? <p className="mt-1 text-xs text-muted">{f.message}</p> : null}
            <p className="mt-2 text-xs text-cream">{f.fix}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ResultScreen({
  id,
  result,
  onReload,
}: {
  id: string;
  result: BuildResult;
  onReload: () => void;
}) {
  const [tab, setTab] = useState<Tab>("try");
  const [copied, setCopied] = useState(false);
  const report = result.metrics.report;
  const docs = useMemo(() => result.artifact?.docs ?? {}, [result.artifact]);
  const needs = useMemo(() => {
    const names = new Set<string>();
    for (const m of (docs["DEPLOY.md"] ?? "").matchAll(ENV_NAME)) {
      if (m[1] && !SECRETLESS_DEFAULTS.has(m[1])) names.add(m[1]);
    }
    return [...names].slice(0, 12);
  }, [docs]);
  const works = (report?.criteria ?? []).filter((c) => c.verified);
  const pending = (report?.criteria ?? []).filter((c) => !c.verified);
  const h = result.metrics.handover;
  const components = (result.metrics.components ?? []).map((c) =>
    typeof c === "string" ? c : (c.id ?? ""),
  );
  const usesAi = components.includes("ai.orchestrator.turbineh");

  return (
    <>
      <section aria-label="Result" className="grid gap-6 lg:grid-cols-2">
        <Panel title="What works">
          {report ? <p className="mb-3 text-sm text-cream">{report.headline}</p> : null}
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex gap-2">
              <span className="text-teal" aria-hidden="true">
                ✓
              </span>
              {result.verified === false
                ? `Not verified: ${h?.checksPassed ?? "—"}/${h?.checksTotal ?? "—"} checks passed in the sandbox — see the failure above`
                : `Package verified in the sandbox: ${h?.checksPassed ?? "—"}/${h?.checksTotal ?? "—"} checks (build, tests, end-to-end, secrets, security rules, vulnerabilities, licences)`}
            </li>
            {works.slice(0, 6).map((c) => (
              <li key={c.criterion} className="flex gap-2">
                <span className="text-teal" aria-hidden="true">
                  ✓
                </span>
                <span>
                  {c.criterion}
                  <span className="block text-xs text-muted">{c.evidence}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Needs your configuration">
          {needs.length === 0 && pending.length === 0 ? (
            <p className="text-sm text-teal">Nothing pending.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {needs.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="text-amber" aria-hidden="true">
                    ○
                  </span>
                  <span>
                    <span className="font-mono text-ice-2">{n}</span>
                    <span className="block text-xs text-muted">
                      Set it in your environment (see config/.env.example)
                    </span>
                  </span>
                </li>
              ))}
              {pending.map((c) => (
                <li key={c.criterion} className="flex gap-2">
                  <span className="text-amber" aria-hidden="true">
                    ○
                  </span>
                  <span>
                    {c.criterion}
                    <span className="block text-xs text-muted">
                      Not verified automatically — check it in your project
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          value={pct(result.metrics.reuse?.reusedShare)}
          label="Reused from verified components"
          accent
        />
        <Stat
          value={String(result.metrics.reuse?.generatedLines ?? "—")}
          label="New lines to maintain (the glue)"
        />
        <Stat
          value={String(h?.fixedBeforeDelivery ?? 0)}
          label="Security issues fixed before delivery"
        />
        <Stat value={String(components.length)} label="Verified components used" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setTab("try")}
          className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy"
        >
          Try example
        </button>
        <a
          href={result.artifact?.zip_url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-teal px-5 py-2 text-sm text-teal hover:bg-teal/10"
        >
          Download ZIP
        </a>
        {result.verified === false ? null : (
          <a
            href="#integrate"
            className="rounded-full border border-line px-5 py-2 text-sm text-ice-2 hover:border-teal"
          >
            Integrate into repository
          </a>
        )}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(AGENT_INSTRUCTIONS).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            })
          }
          className="rounded-full border border-line px-5 py-2 text-sm text-ice-2 hover:border-teal"
        >
          {copied ? "Copied ✓" : "Copy instructions for your AI agent"}
        </button>
      </div>

      {result.verified === false ? null : (
        <div id="integrate" className="scroll-mt-24">
          <RepoIntegration planId={id} />
        </div>
      )}

      <div>
        <div
          role="tablist"
          aria-label="Result details"
          className="flex flex-wrap gap-2 border-b border-line pb-3"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm ${tab === t.key ? "bg-teal text-navy" : "text-muted hover:text-ice-2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="mt-5 flex flex-col gap-6"
        >
          {tab === "try" ? (
            <>
              <Panel title="Run the example with sample data">
                <pre className="prose-doc overflow-auto rounded-lg bg-navy-900/80 p-4 text-ice-2">{`unzip ${result.artifact?.slug ?? "package"}.zip && cd ${result.artifact?.slug ?? "package"}
pnpm install
cp .env.example .env.local     # fill the values listed under "Needs your configuration"
pnpm db:migrate && pnpm db:seed
pnpm dev                       # http://localhost:3000`}</pre>
                <p className="mt-3 text-xs text-muted">
                  Or put it live in your own accounts in minutes — you own everything:
                </p>
                <div className="mt-3">
                  <DeployForMe id={id} onDone={onReload} />
                </div>
              </Panel>
              {usesAi ? (
                <Panel title="AI access">
                  <AiAccess id={id} />
                </Panel>
              ) : null}
            </>
          ) : null}
          {tab === "review" ? (
            <>
              <Panel title={`Components used · ${components.length}`}>
                <ul className="grid gap-2 font-mono text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {components.map((c) => (
                    <li key={c} className="rounded border border-line px-2 py-1 text-ice-2">
                      {c}
                    </li>
                  ))}
                </ul>
              </Panel>
              <DocsPanel
                docs={docs}
                order={["COMPONENTS.md", "ARCHITECTURE.md", "README.md"]}
                files={result.artifact?.files ?? []}
              />
            </>
          ) : null}
          {tab === "check" ? (
            <>
              {report ? (
                <Panel title="Security">
                  <p
                    className={`text-sm font-semibold ${report.security.status === "clear" ? "text-teal" : "text-amber"}`}
                  >
                    {report.security.statusLine}
                  </p>
                  {report.security.points.length > 0 ? (
                    <ul className="mt-3 list-disc pl-5 text-sm text-ice-2">
                      {report.security.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : null}
                  {report.security.status === "alerts" ? (
                    <ImproveCallout
                      id={id}
                      improved={Boolean(result.metrics.improved)}
                      estimate={report.improvement}
                      existingId={result.improvement_build_id}
                    />
                  ) : null}
                </Panel>
              ) : null}
              <DocsPanel docs={docs} order={["SECURITY.md", "TURBINEH_REPORT.md"]} />
            </>
          ) : null}
          {tab === "continue" ? (
            <>
              <Panel title="For your AI coding agent">
                <p className="text-sm text-ice-2">{AGENT_INSTRUCTIONS}</p>
                <p className="mt-3 text-xs text-muted">
                  Or from the terminal: <code className="text-teal">turbineh apply {id}</code> then{" "}
                  <code className="text-teal">turbineh verify</code> — the CLI returns the same
                  state as this page.
                </p>
              </Panel>
              {report?.nextSteps.length ? (
                <Panel title="Next steps">
                  <ol className="list-decimal pl-5 text-sm text-ice-2">
                    {report.nextSteps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </Panel>
              ) : null}
              <DocsPanel docs={docs} order={["DEPLOY.md", "DEPLOYED.md", "README.md"]} />
            </>
          ) : null}
          {tab === "revert" ? (
            <Panel title="Undo the integration without losing later work">
              <ul className="flex flex-col gap-3 text-sm text-ice-2">
                <li>
                  <span className="text-cream">Integrated in a repository:</span> it arrives as one
                  pull request / one commit. Revert that commit — your later commits stay —{" "}
                  <code className="text-teal">git revert &lt;integration-commit&gt;</code> or{" "}
                  <code className="text-teal">turbineh revert {id}</code>.
                </li>
                <li>
                  <span className="text-cream">From the ZIP:</span> the package lives in its own
                  folder with its own entry points; remove the folder and the lines listed in
                  docs/integration.md.
                </li>
                <li>
                  <span className="text-cream">Deployed for you:</span> the project and database
                  live in your own accounts; delete them there at any time.
                </li>
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function DocsPanel({
  docs,
  order,
  files,
}: {
  docs: Record<string, string>;
  order: string[];
  files?: string[];
}) {
  const keys = order.filter((d) => docs[d]);
  const [doc, setDoc] = useState(keys[0] ?? "");
  if (keys.length === 0 && !files) return null;
  return (
    <div className={`grid gap-6 ${files ? "lg:grid-cols-[260px_1fr]" : ""}`}>
      {files ? (
        <Panel title={`Files · ${files.length}`}>
          <ul className="max-h-[420px] overflow-auto font-mono text-xs text-muted">
            {files.map((f) => (
              <li key={f} style={{ paddingLeft: `${(f.split("/").length - 1) * 10}px` }}>
                {f.split("/").pop()}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {keys.length > 0 ? (
        <Panel title="Documents">
          <div className="mb-3 flex flex-wrap gap-2">
            {keys.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={doc === d}
                onClick={() => setDoc(d)}
                className={`rounded-full px-3 py-1 text-xs ${doc === d ? "bg-teal text-navy" : "border border-line text-muted"}`}
              >
                {d.replace(".md", "")}
              </button>
            ))}
          </div>
          <div className="prose-doc max-h-[480px] overflow-auto text-ice-2">
            {(docs[doc] ?? "").replace(/^<!-- turbineh:generated -->\n/, "")}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ImproveCallout({
  id,
  improved,
  estimate,
  existingId,
}: {
  id: string;
  improved: boolean;
  estimate: ImprovementEstimate | null;
  existingId: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  let text: string;
  let offer = false;
  if (improved)
    text =
      "This is the improved, final version. Remaining alerts could not be fixed automatically.";
  else if (existingId) text = "The improvement of this flow was already requested (once per flow).";
  else if (!estimate || estimate.fixable === 0)
    text = "None of the remaining alerts can be fixed automatically.";
  else {
    offer = true;
    text = `We can most likely fix ${estimate.fixable} of ${estimate.total} remaining alert(s) in about ${estimate.minutes.min}–${estimate.minutes.max} min; every check runs again. Once per flow.`;
  }
  return (
    <div className="mt-4 rounded-lg border border-amber/50 p-4">
      <p className="text-sm text-ice-2">{text}</p>
      {offer ? (
        <button
          type="button"
          disabled={state === "working"}
          onClick={async () => {
            setState("working");
            const res = await fetch(`/v1/builds/${id}/improve`, { method: "POST" });
            const body = (await res.json().catch(() => ({}))) as { build_id?: string };
            if (body.build_id) return router.push(`/flows/${body.build_id}`);
            setState("error");
          }}
          className="mt-3 rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          {state === "working" ? "Starting…" : "Improve & re-verify"}
        </button>
      ) : null}
      {existingId ? (
        <a href={`/flows/${existingId}`} className="mt-3 inline-block text-sm text-teal underline">
          Open the improved flow
        </a>
      ) : null}
      {state === "error" ? (
        <p className="mt-2 text-xs text-bad">Could not start it. Try again in a moment.</p>
      ) : null}
    </div>
  );
}

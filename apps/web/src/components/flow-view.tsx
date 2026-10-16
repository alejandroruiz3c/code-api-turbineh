"use client";
import type {
  DeliveryManifest,
  EstimateVsActual,
  FlowOutcome,
  FlowState,
  NotCoveredExplanation,
  Plan,
} from "@turbineh/shared";
import { functionalRatio } from "@turbineh/shared/status-texts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentRun, isWorking } from "@/lib/flow-events";
import { followFlow, type FollowEvent, type FollowSnapshot } from "@/lib/flow-follow";
import { describeProgress, duration, type RunKind } from "@/lib/flow-progress";
import { FlowFinished, FlowSteps, LiveNow, PackageResult } from "./flow-live";
import { AGENT_INSTRUCTIONS, productApi } from "@/lib/product-api";
import { AiAccess } from "./ai-access";
import { EstimateComparison } from "./estimate-comparison";
import { DeployForMe } from "./deploy-for-me";
import { NotCovered } from "./not-covered";
import { RepoIntegration } from "./repo-integration";
import { badgeOf, Panel, StateBadge, Stat, pct } from "./ui";

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

/** How the build was corrected (ADR-0065): written by code from the gate's own results. */
interface CorrectionAudit {
  firstPass: { name: string; status: "pass" | "warn" | "fail" }[];
  firstPassProblems: string[];
  corrections: {
    phase: "correction" | "backup-correction" | "swap" | "security-fix" | "repair";
    round: number;
    commit: string | null;
    files: string[];
    why: string;
    diff: string;
    truncated: boolean;
  }[];
  refused: { phase: string; file: string; reason: string }[];
  fixed: { rule: string; where: string; round: number }[];
  notFixed: { rule: string; where: string }[];
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
  /** `use_case_not_covered` (ADR-0052): the requirements the library does not cover yet. */
  notCovered?: string[];
  /** `use_case_not_covered` (ADR-0062): why, the priority notice and what we can do now (offer). */
  explanation?: NotCoveredExplanation;
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
  /** Persisted start of the current run and its duration when finished (N-03, ADR-0066). */
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  /** The plan's estimate next to what the run really took (F-06, ADR-0066). */
  estimate_vs_actual?: EstimateVsActual | null;
  metrics: {
    plan?: Plan;
    reuse?: { reusedShare?: number; reusedLines?: number; generatedLines?: number };
    components?: (string | { id?: string })[];
    alerts?: { id: string; level: string; title: string; explain: string; where: string }[];
    report?: BuildReport;
    improved?: boolean;
    handover?: {
      checksPassed?: number;
      checksTotal?: number;
      checksWithWarnings?: number;
      fixedBeforeDelivery?: number;
    };
    audit?: CorrectionAudit;
    deployment?: { url?: string } | null;
    timings?: Record<string, number>;
    /** ADR-0064: the reconciled delivery manifest every surface is rendered from. */
    manifest?: DeliveryManifest;
  };
  artifact: {
    slug?: string;
    zip_url: string | null;
    files: string[];
    docs: Record<string, string>;
    report_only?: boolean;
    /** F20: commands to run the app, from its real files and package.json scripts (API). */
    quickstart?: string[];
  } | null;
}

/**
 * "Finished in …" from the persisted duration only (N-03, ADR-0066): finished_at − started_at of the run, never the
 * time since the page or the flow was opened. Without a persisted duration, no figure.
 */
export function finishedLine(durationMs: number | null | undefined): string {
  return typeof durationMs === "number" && durationMs >= 0
    ? `Finished in ${duration(durationMs)}.`
    : "Finished.";
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

export function FlowView({
  id,
  initial,
}: {
  id: string;
  /** Persisted row and trace rendered by the server (N-03, ADR-0066). */
  initial?: { result: BuildResult | null; events: FollowEvent[] };
}) {
  const [snap, setSnap] = useState<FollowSnapshot<BuildResult>>(() => ({
    events: initial?.events ?? [],
    result: initial?.result ?? null,
    connection: "connecting",
    lastEventAt: Date.now(),
  }));
  const [now, setNow] = useState(() => Date.now());
  const [typical, setTypical] = useState<Partial<Record<RunKind, Record<string, number>>>>({});
  const follower = useRef<ReturnType<typeof followFlow> | null>(null);
  const initialRef = useRef(initial);

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
      ...(initialRef.current ? { initial: initialRef.current } : {}),
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
  // ADR-0064: what each part of the build is for (relevance), instead of the selection's fit alone.
  const decided = by("selecting", "manifest") as
    | {
        entries?: {
          capability: string;
          label: string;
          way: string;
          component: string | null;
          justifiedBy: { kind: string; ref: string }[];
          reason?: string;
        }[];
        notSelected?: { capability: string; label: string }[];
      }
    | undefined;
  const verifying = run.filter((e) => e.phase === "verifying" && e.type === "done").at(-1)?.data as
    { steps?: { name: string; ok: boolean; ms: number }[]; package?: string } | undefined;
  const compiling = by("compiling") as
    { decisions?: { recipe?: { choice: string; confidence: number } } } | undefined;
  const scope = by("compiling", "scope") as { builtOn?: string } | undefined;
  // ADR-0052: the scope gate's verdict (the plan run's, kept on the row's event trace).
  const gate = [...events].reverse().find((e) => e.phase === "compiling" && e.type === "scope_gate")
    ?.data as { status?: string; notCovered?: { requirement: string; why: string }[] } | undefined;

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
        <StateBadge state={state} {...badgeOf(outcome)} />
        <span className="text-sm text-muted">
          {terminal
            ? finishedLine(result?.duration_ms)
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
                  No product family matched the headline, but every requirement maps to verified
                  components, so it is built on <span className="text-cream">{scope.builtOn}</span>.
                </p>
              ) : (
                <p className="text-sm">
                  <span className="text-cream">{compiling.decisions.recipe.choice}</span>{" "}
                  <span className="text-muted">
                    · confidence {pct(compiling.decisions.recipe.confidence)}
                  </span>
                </p>
              )}
              {gate?.status === "partial" && gate.notCovered?.length ? (
                <div className="mt-3 text-sm">
                  <p className="text-amber">
                    Only the covered part is built. Removed from scope (the library doesn&rsquo;t
                    cover them yet):
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-ice-2">
                    {gate.notCovered.map((r) => (
                      <li key={r.requirement}>{r.requirement}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Panel>
          ) : null}
          {decided?.entries ? (
            <Panel
              title={`Decisions · ${decided.entries.length} capabilities, each justified by your request`}
            >
              <ul className="grid gap-2 sm:grid-cols-2" data-testid="live-decisions">
                {decided.entries.map((d) => (
                  <li
                    key={d.capability}
                    className="rounded-lg border border-line px-3 py-2 text-xs"
                  >
                    <p className="font-mono text-muted">{d.capability}</p>
                    <p className={`mt-1 ${d.way === "not_included" ? "text-amber" : "text-ice-2"}`}>
                      {d.way === "component"
                        ? d.component
                        : d.way === "recipe"
                          ? "implemented by the use case's template"
                          : d.way === "written"
                            ? "no verified component — TurbineH writes it (not catalogue-verified)"
                            : `not included — ${d.reason ?? ""}`}
                    </p>
                    <p className="mt-1 text-muted">
                      {d.justifiedBy.length
                        ? `For: ${d.justifiedBy
                            .map((j) =>
                              j.kind === "criterion" || j.kind === "requirement"
                                ? `“${j.ref}”`
                                : j.kind === "transversal"
                                  ? `every app (${j.ref})`
                                  : j.kind === "use_case"
                                    ? `the ${j.ref} use case`
                                    : `needed by ${j.ref}`,
                            )
                            .join("; ")}`
                        : "Nothing in the request justifies it"}
                    </p>
                  </li>
                ))}
              </ul>
              {decided.notSelected?.length ? (
                <p className="mt-3 text-xs text-muted">
                  Left out, not asked for: {decided.notSelected.map((n) => n.label).join(", ")}.
                </p>
              ) : null}
            </Panel>
          ) : selecting?.decisions ? (
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
  // ADR-0062: a refused direct build whose use case is not covered, with verified components that serve part of it.
  async function buildComponents() {
    setBusy(true);
    setError(null);
    const r = await productApi.startBuild(result.prompt ?? "", { componentsOnly: true });
    setBusy(false);
    if (r.ok) return window.location.assign(`/flows/${encodeURIComponent(r.data.build_id)}`);
    setError(r.error ? `${r.error.message} → ${r.error.action}` : "It could not start.");
  }
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
        {p?.explanation ? (
          <div className="mt-3">
            <NotCovered
              explanation={p.explanation}
              action={
                p.explanation.offer && result.prompt ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-action="build_components"
                    onClick={() => void buildComponents()}
                    className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy disabled:opacity-50"
                  >
                    {busy ? "Starting…" : "Build the verified components"}
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : null}
        {!p?.explanation && p?.notCovered?.length ? (
          <div className="mt-3">
            <p className="text-sm text-muted">Not covered by the library yet:</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ice-2" data-testid="not-covered">
              {p.notCovered.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
  // ADR-0064 (F-11): the app's settings from its single env schema, required and optional apart. Flows delivered
  // before the manifest fall back to the names DEPLOY.md lists.
  const manifest = result.metrics.manifest;
  const settings = useMemo(() => {
    if (manifest)
      return {
        required: manifest.env.required.map((e) => e.name),
        optional: manifest.env.optional.map((e) => e.name),
      };
    const names = new Set<string>();
    for (const m of (docs["DEPLOY.md"] ?? "").matchAll(ENV_NAME)) {
      if (m[1] && !SECRETLESS_DEFAULTS.has(m[1])) names.add(m[1]);
    }
    return { required: [...names], optional: [] as string[] };
  }, [docs, manifest]);
  const broken = manifest?.brokenPromises ?? [];
  const excluded = manifest
    ? manifest.entries.filter(
        (e) =>
          (e.way === "not_included" || e.status === "not_delivered") &&
          !broken.some((b) => b.capability === e.capability),
      )
    : [];
  const works = (report?.criteria ?? []).filter((c) => c.verified);
  const pending = (report?.criteria ?? []).filter((c) => !c.verified);
  // One state model (F18): the same count as the badge, the API and the CLI.
  const req = result.outcome?.requirements ?? {
    met: works.length,
    total: works.length + pending.length,
  };
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
                : `Build checks passed in the sandbox: ${h?.checksPassed ?? "—"}/${h?.checksTotal ?? "—"} (build, tests, end-to-end, secrets, security rules, vulnerabilities, licences)`}
            </li>
            <li className="flex gap-2">
              <span className={req.met < req.total ? "text-amber" : "text-teal"} aria-hidden="true">
                {req.met < req.total ? "○" : "✓"}
              </span>
              {`Functional coverage: ${req.met}/${req.total} requirements proven by a passing test (${Math.round(functionalRatio(req.met, req.total) * 100)}%)${req.met < req.total ? " — the open ones are listed under “Requirements not met yet”" : ""}`}
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
        <div className="flex flex-col gap-6">
          {/* F18: settings and unmet requirements are different things; neither is "configuration" for the other. */}
          <Panel title="Settings">
            {settings.required.length + settings.optional.length === 0 ? (
              <p className="text-sm text-teal">Nothing to set.</p>
            ) : (
              (
                [
                  ["Required", settings.required, "The app needs these to do what you asked."],
                  ["Optional", settings.optional, "Defaults work; set them to change behaviour."],
                ] as const
              ).map(([title, names, hint]) =>
                names.length > 0 ? (
                  <div
                    key={title}
                    className="mb-3"
                    data-testid={`result-settings-${title.toLowerCase()}`}
                  >
                    <p className="text-sm font-semibold text-cream">
                      {title} · {names.length}
                    </p>
                    <p className="text-xs text-muted">
                      {hint} Set them in .env.local (documented in{" "}
                      {result.artifact?.files.includes(".env.example")
                        ? ".env.example"
                        : "config/.env.example"}
                      ) and in your host; DEPLOY.md explains each one.
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                      {names.map((n) => (
                        <li key={n} className="font-mono text-ice-2">
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )
            )}
          </Panel>
          {broken.length > 0 ? (
            <Panel title="Approved in the plan, not delivered">
              <ul className="flex flex-col gap-2 text-sm" data-testid="broken-promises">
                {broken.map((b) => (
                  <li key={b.capability} className="flex gap-2">
                    <span className="text-bad" aria-hidden="true">
                      ✗
                    </span>
                    <span>
                      {b.label}
                      <span className="block text-xs text-muted">
                        The plan promised {b.promised}. {b.reason}. The package is not verified
                        until it is implemented and proven by a test.
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {excluded.length > 0 ? (
            <Panel title="Not included in this build">
              <ul className="flex flex-col gap-2 text-sm">
                {excluded.map((e) => (
                  <li key={e.capability}>
                    {e.label}
                    <span className="block text-xs text-muted">{e.reason}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {pending.length > 0 ? (
            <Panel title="Requirements not met yet">
              <ul className="flex flex-col gap-2 text-sm">
                {pending.map((c) => (
                  <li key={c.criterion} className="flex gap-2">
                    <span className="text-amber" aria-hidden="true">
                      ○
                    </span>
                    <span>
                      {c.criterion}
                      <span className="block text-xs text-muted">
                        No passing test proves it yet: AGENTS.md (&ldquo;What is left&rdquo;) says
                        where to implement and prove it
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
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
          value={result.metrics.audit ? String(result.metrics.audit.fixed.length) : "—"}
          label={
            result.metrics.audit
              ? "Security issues fixed before delivery (confirmed by a new scan)"
              : "Security fixes (not re-scanned in flows before this was counted)"
          }
        />
        <Stat value={String(components.length)} label="Verified components used" />
      </div>
      {result.estimate_vs_actual ? <EstimateComparison data={result.estimate_vs_actual} /> : null}

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
                {/* F20: from the delivered app's real files and package.json scripts (API `quickstart`). */}
                <pre className="prose-doc overflow-auto rounded-lg bg-navy-900/80 p-4 text-ice-2">
                  {(
                    result.artifact?.quickstart ?? [
                      `unzip ${result.artifact?.slug ?? "app"}.zip && cd ${result.artifact?.slug ?? "app"}`,
                      "pnpm install",
                      "cp .env.example .env.local",
                      "pnpm dev",
                    ]
                  ).join("\n")}
                </pre>
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
              {result.metrics.audit ? <CorrectionPanel audit={result.metrics.audit} /> : null}
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

const PHASE_LABEL: Record<CorrectionAudit["corrections"][number]["phase"], string> = {
  correction: "Directed correction",
  "backup-correction": "Backup Coder correction",
  swap: "Removed generated part",
  "security-fix": "Security fix",
  repair: "Repair after a security fix",
};
const STATUS_LABEL = { pass: "pass", warn: "pass with warnings", fail: "failed" } as const;

/** ADR-0065: the checks of the first pass, each correction with its diff, refused changes and verified fixes. */
function CorrectionPanel({ audit }: { audit: CorrectionAudit }) {
  const failed = audit.firstPass.filter((c) => c.status === "fail");
  const warned = audit.firstPass.filter((c) => c.status === "warn");
  return (
    <Panel title="How this build was corrected">
      <p className="text-sm text-ice-2">
        First pass:{" "}
        {failed.length === 0
          ? "every check passed"
          : `${failed.length} check(s) failed (${failed.map((c) => c.name).join(", ")})`}
        {warned.length > 0
          ? ` · ${warned.length} passed with warnings (${warned.map((c) => c.name).join(", ")})`
          : ""}
        .
      </p>
      {audit.firstPassProblems.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 font-mono text-xs text-muted">
          {audit.firstPassProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {audit.corrections.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No correction was needed.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {audit.corrections.map((c) => (
            <li key={`${c.phase}-${c.round}-${c.commit ?? ""}`}>
              <details>
                <summary className="cursor-pointer text-ice-2">
                  {PHASE_LABEL[c.phase]} {c.round}
                  {c.commit ? (
                    <span className="font-mono text-xs text-muted"> · {c.commit.slice(0, 12)}</span>
                  ) : null}{" "}
                  <span className="text-xs text-muted">— {c.why}</span>
                </summary>
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg bg-navy-900/80 p-3 text-xs text-ice-2">
                  {c.diff}
                  {c.truncated ? `\n… (git show ${c.commit?.slice(0, 12) ?? ""} for the rest)` : ""}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      {audit.refused.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-amber">
            Refused changes · tests, rules and check configuration are never a repair&rsquo;s target
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted">
            {audit.refused.map((r) => (
              <li key={`${r.phase}-${r.file}-${r.reason}`}>
                <span className="font-mono">{r.file}</span> ({r.phase}): {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-muted">
        Security findings fixed automatically and confirmed by a new scan: {audit.fixed.length}
        {audit.notFixed.length > 0
          ? ` · attempted but still present: ${audit.notFixed.length} (${audit.notFixed.map((f) => `${f.rule} at ${f.where}`).join("; ")})`
          : ""}
        .
      </p>
      <p className="mt-1 text-xs text-muted">
        First-pass status per check:{" "}
        {audit.firstPass.map((c) => `${c.name} ${STATUS_LABEL[c.status]}`).join(" · ")}
      </p>
    </Panel>
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

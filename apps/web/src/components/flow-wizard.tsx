"use client";
import type { EnvironmentInput, NotCoveredExplanation, Plan, PlanAction } from "@turbineh/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { environmentFor, stackNote, SUPPORTED_STACK, type EnvMode } from "@/lib/flow-environment";
import { productApi } from "@/lib/product-api";
import { matchUseCases, USE_CASES, type UseCase } from "@/lib/use-cases";
import { GithubConnect, RepoAnalysisView, RepoPicker, useGithub } from "./github-connect";
import { COMPONENTS_ONLY_APPROVAL, NotCovered } from "./not-covered";
import { PlanReview } from "./plan-review";
import { Panel } from "./ui";

type Step = 1 | 2 | 3;

/** Manifest files that are enough to detect the stack; nothing else is read from an upload. */
const MANIFESTS =
  /(^|\/)(package\.json|tsconfig\.json|next\.config\.(js|mjs|ts)|vite\.config\.(js|ts)|requirements\.txt|pyproject\.toml|go\.mod|Gemfile|composer\.json|pnpm-workspace\.yaml|\.nvmrc)$/;
const MAX_FILE = 200_000;

const FRAMEWORKS: Record<string, string[]> = {
  TypeScript: ["Next.js", "Express", "Remix", "NestJS", "Hono", "Vite + React"],
  JavaScript: ["Next.js", "Express", "Vite + React"],
  Python: ["Django", "FastAPI", "Flask"],
  Go: ["net/http", "Gin"],
};

const NEEDS = [
  "An AI booking agent for a physiotherapy clinic that checks availability and books 45-minute appointments",
  "A simple online store for a sock brand with sizes, cart and card payments",
  "A support assistant that answers from our help centre and escalates to a human",
];

export function FlowWizard({
  need: initialNeed,
  capability,
}: {
  need: string;
  capability: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [need, setNeed] = useState(initialNeed);
  const [mode, setMode] = useState<EnvMode>("app");
  const [repo, setRepo] = useState("");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState("TypeScript");
  const [framework, setFramework] = useState("Next.js");
  const [versions, setVersions] = useState("next 16, node 24, postgres 17");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [engineMissing, setEngineMissing] = useState(false);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    action: string;
    notCovered?: string[];
    explanation?: NotCoveredExplanation;
  } | null>(null);
  const github = useGithub();
  const params = useSearchParams();
  const githubResult = params.get("github");

  // Back from "Connect GitHub": restore the need and continue at the environment step.
  useEffect(() => {
    if (!githubResult) return;
    queueMicrotask(() => {
      const saved = sessionStorage.getItem("tbh_need");
      if (saved) setNeed(saved);
      setMode("repo");
      setStep(2);
      if (githubResult !== "connected")
        setError({
          message:
            githubResult === "cancelled"
              ? "GitHub was not connected (cancelled)."
              : "GitHub could not be connected.",
          action: "Try again, or upload your project's package.json instead.",
        });
    });
  }, [githubResult]);
  useEffect(() => {
    if (need.trim()) sessionStorage.setItem("tbh_need", need);
  }, [need]);

  const environment = useMemo<EnvironmentInput>(
    () => environmentFor(mode, { repo, files, language, framework, versions }),
    [mode, repo, files, language, framework, versions],
  );

  const envReady =
    mode === "repo"
      ? Boolean(environment.repo)
      : mode === "upload"
        ? Object.keys(files).length > 0
        : true;
  const fallbackCapability: UseCase | undefined =
    USE_CASES.find((u) => u.id === capability) ?? matchUseCases(need)[0];

  async function readUpload(list: FileList | null) {
    const out: Record<string, string> = {};
    for (const f of Array.from(list ?? [])) {
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (!MANIFESTS.test(path) || path.includes("node_modules/") || f.size > MAX_FILE) continue;
      out[path.split("/").slice(-3).join("/")] = await f.text();
    }
    setFiles(out);
  }

  async function buildPlan(env: EnvironmentInput = environment) {
    setBusy(true);
    setError(null);
    setApproved({});
    const r = await productApi.plan(need.trim(), env);
    setBusy(false);
    if (r.ok) {
      setPlan(r.data);
      setEngineMissing(false);
    } else if (r.missing) {
      setPlan(null);
      setEngineMissing(true);
    } else {
      setError(
        r.error ?? { message: "The plan could not be built.", action: "Try again in a moment." },
      );
      return;
    }
    setStep(3);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    if (plan) {
      const r = await productApi.generate(plan.id);
      if (r.ok) return router.push(`/flows/${encodeURIComponent(r.data.id || plan.id)}`);
      setBusy(false);
      return setError(r.error ?? { message: "Generation could not start.", action: "Try again." });
    }
    const envLine =
      mode === "repo"
        ? ` Target repository: ${repo.trim()}.`
        : mode === "app"
          ? ` Stack: ${language}${framework ? ` / ${framework}` : ""} (${versions}).`
          : ` Existing project files: ${Object.keys(files).join(", ")}.`;
    const r = await productApi.startBuild(`${need.trim()}${envLine}`);
    if (r.ok) return router.push(`/flows/${r.data.build_id}`);
    setBusy(false);
    setError(r.error ?? { message: "Generation could not start.", action: "Try again." });
  }

  // ADR-0062: "Build the verified components" names the choice itself, so pressing it approves the components-only
  // offer (one action); any other decision still needs its own checkbox.
  const offerChoice = (a: string) =>
    plan?.scope?.status === "components_only" && a.startsWith(COMPONENTS_ONLY_APPROVAL);
  const pendingApprovals = (plan?.needsApproval ?? []).filter(
    (a) => !approved[a] && !offerChoice(a),
  );

  /** The plan's one-click next steps (ADR-0050). */
  function onAction(a: PlanAction) {
    if (a.id === "generate") return void generate();
    if (a.id === "build_nextjs_app") {
      setMode("app");
      setLanguage("TypeScript");
      setFramework("Next.js");
      return void buildPlan({
        stack: {
          language: "TypeScript",
          framework: "Next.js",
          versions: { next: "16", node: "24", postgres: "17" },
        },
      });
    }
    setMode(a.id === "connect_repo" ? "repo" : "upload");
    setPlan(null);
    setStep(2);
  }
  const generateLabel =
    plan?.outcome?.actions.find((a) => a.id === "generate")?.label ?? "Generate & verify";

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <ol aria-label="Steps" className="flex flex-col gap-3 text-sm">
        {["Describe the need", "Choose what we build", "Review the plan"].map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li
              key={label}
              className="flex items-center gap-3"
              aria-current={step === n ? "step" : undefined}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${step > n ? "border-teal bg-teal text-navy" : step === n ? "border-amber text-amber" : "border-line text-muted"}`}
              >
                {step > n ? "✓" : n}
              </span>
              <span className={step >= n ? "text-ice-2" : "text-muted"}>{label}</span>
            </li>
          );
        })}
        <li className="flex items-center gap-3 text-muted">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs">
            4
          </span>
          Generate &amp; verify
        </li>
      </ol>

      <div className="flex flex-col gap-6">
        {error ? (
          <div role="alert" className="rounded-lg border border-bad/60 p-4 text-sm">
            {error.explanation ? (
              // ADR-0062: what is not covered and why, the priority notice and what we can do now.
              <NotCovered explanation={error.explanation} />
            ) : (
              <p className="text-bad">{error.message}</p>
            )}
            {!error.explanation && error.notCovered?.length ? (
              // ADR-0052: what the library doesn't cover yet, so the person knows what was asked for.
              <ul className="mt-2 list-disc pl-5 text-ice-2" data-testid="not-covered">
                {error.notCovered.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1 text-ice-2">→ {error.action}</p>
          </div>
        ) : null}

        {step === 1 ? (
          <Panel title="1 · What capability do you need?">
            <label htmlFor="need" className="sr-only">
              Describe the need
            </label>
            <textarea
              id="need"
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Describe it in your words: what it must do, for whom, and any rule that matters."
              className="w-full resize-y rounded-lg border border-line bg-navy-900/80 p-4 text-sm text-ice-2 placeholder:text-muted focus:border-teal focus:outline-none"
            />
            <p className="mt-3 text-xs text-muted">Examples</p>
            <div className="mt-2 flex flex-col gap-2">
              {NEEDS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNeed(n)}
                  className="rounded-lg border border-line px-3 py-2 text-left text-xs text-ice-2 hover:border-teal"
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={need.trim().length < 10}
              onClick={() => setStep(2)}
              className="mt-5 rounded-full bg-amber px-5 py-2.5 text-sm font-semibold text-navy disabled:opacity-40"
            >
              Continue
            </button>
          </Panel>
        ) : null}

        {step === 2 ? (
          <Panel title="2 · What do we build?">
            <div role="tablist" aria-label="Environment" className="flex flex-wrap gap-2">
              {(
                [
                  ["app", "A new complete app"],
                  ["repo", "Add to my repository"],
                  ["upload", "Use my project's files"],
                ] as [EnvMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-sm ${mode === m ? "bg-teal text-navy" : "border border-line text-muted hover:text-ice-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "repo" ? (
              <div className="mt-5 flex flex-col gap-4">
                <GithubConnect
                  status={github.status}
                  returnTo="/flows/new"
                  onChange={() => void github.reload()}
                />
                {github.status?.connected ? (
                  <RepoPicker value={repo} onPick={setRepo} />
                ) : (
                  <div>
                    <label htmlFor="repo" className="text-xs text-muted">
                      Or a public repository (owner/name) — analysed without connecting
                    </label>
                    <input
                      id="repo"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="acme/web-app"
                      className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                )}
                {/^[\w.-]+\/[\w.-]+$/.test(repo.trim()) ? (
                  <RepoAnalysisView fullName={repo.trim()} />
                ) : null}
              </div>
            ) : null}

            {mode === "upload" ? (
              <div className="mt-5">
                <label htmlFor="upload" className="text-xs text-muted">
                  Select your project folder — only manifests are read (package.json, tsconfig,
                  framework config…)
                </label>
                <input
                  id="upload"
                  type="file"
                  multiple
                  // @ts-expect-error -- non-standard but widely supported folder picker
                  webkitdirectory=""
                  onChange={(e) => void readUpload(e.target.files)}
                  className="mt-2 block text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-teal file:px-4 file:py-1.5 file:text-navy"
                />
                {Object.keys(files).length > 0 ? (
                  <p className="mt-2 font-mono text-xs text-teal">
                    Read: {Object.keys(files).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {mode === "app" ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <p data-testid="supported-stack" className="text-xs text-ice-2 sm:col-span-3">
                  Supported stack for new apps:{" "}
                  <span className="text-cream">{SUPPORTED_STACK}</span>. Other choices are marked
                  &ldquo;not supported&rdquo;: you get the same Next.js app, as described below.
                </p>
                <label className="text-xs text-muted">
                  Language
                  <select
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                      setFramework(FRAMEWORKS[e.target.value]?.[0] ?? "");
                    }}
                    className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm text-ice-2"
                  >
                    {Object.keys(FRAMEWORKS).map((l) => (
                      <option key={l} value={l}>
                        {l === "TypeScript"
                          ? l
                          : l === "JavaScript"
                            ? `${l} (app written in TypeScript)`
                            : `${l} (not supported for new apps)`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Framework
                  <select
                    value={framework}
                    onChange={(e) => setFramework(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm text-ice-2"
                  >
                    {(FRAMEWORKS[language] ?? []).map((f) => (
                      <option key={f} value={f}>
                        {f === "Next.js" ? f : `${f} (not supported for new apps)`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Versions
                  <input
                    value={versions}
                    onChange={(e) => setVersions(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm text-ice-2"
                  />
                </label>
                <p
                  data-testid="stack-note"
                  className="rounded-lg border border-teal/50 p-3 text-xs text-ice-2 sm:col-span-3"
                >
                  {stackNote(language, framework)} Already have a project? Choose &ldquo;Add to my
                  repository&rdquo; or &ldquo;Use my project&apos;s files&rdquo; above.
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full border border-line px-4 py-2 text-sm text-muted"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!envReady || busy}
                onClick={() => void buildPlan()}
                className="rounded-full bg-amber px-5 py-2.5 text-sm font-semibold text-navy disabled:opacity-40"
              >
                {busy ? "Planning…" : "Build the plan"}
              </button>
            </div>
          </Panel>
        ) : null}

        {step === 3 && plan ? (
          <PlanReview
            plan={plan}
            approved={approved}
            onApprove={(a, v) => setApproved({ ...approved, [a]: v })}
            onAction={onAction}
            busy={busy}
            blockGenerate={pendingApprovals.length > 0}
          />
        ) : null}

        {step === 3 && !plan && engineMissing && fallbackCapability ? (
          <Panel title="3 · Plan">
            <h3 className="display text-xl font-semibold text-cream">{fallbackCapability.name}</h3>
            <p className="mt-1 text-sm text-ice-2">{fallbackCapability.summary}</p>
            <p className="mt-4 text-sm text-ice-2">
              <span className="text-muted">You will provide:</span>{" "}
              <span className="font-mono">
                {fallbackCapability.requirements.map((r) => r.name).join(", ")}
              </span>
            </p>
            <p className="mt-4 rounded-lg border border-line p-3 text-xs text-muted">
              The file-by-file plan for your project appears here as soon as the engine has analysed
              it. You can generate and verify the package now; nothing is applied to your project
              without your approval.
            </p>
          </Panel>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-full border border-line px-4 py-2 text-sm text-muted"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || pendingApprovals.length > 0}
              onClick={() => void generate()}
              className="rounded-full bg-amber px-6 py-2.5 text-sm font-semibold text-navy disabled:opacity-40"
            >
              {busy ? "Starting…" : generateLabel}
            </button>
            {pendingApprovals.length > 0 ? (
              <span className="text-xs text-amber">
                Approve the {pendingApprovals.length} decision(s) above first.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

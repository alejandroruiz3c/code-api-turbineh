"use client";
import type { EnvironmentInput, Plan } from "@turbineh/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { productApi } from "@/lib/product-api";
import { matchUseCases, USE_CASES, type UseCase } from "@/lib/use-cases";
import { Panel } from "./ui";

type EnvMode = "repo" | "upload" | "stack";
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
  const [mode, setMode] = useState<EnvMode>("stack");
  const [repo, setRepo] = useState("");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState("TypeScript");
  const [framework, setFramework] = useState("Next.js");
  const [versions, setVersions] = useState("next 16, node 24, postgres 17");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [engineMissing, setEngineMissing] = useState(false);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; action: string } | null>(null);

  const environment = useMemo<EnvironmentInput>(() => {
    if (mode === "repo") {
      const [owner, name] = repo.trim().split("/");
      return owner && name ? { repo: { provider: "github", fullName: `${owner}/${name}` } } : {};
    }
    if (mode === "upload") return { files };
    const v = Object.fromEntries(
      versions
        .split(",")
        .map((p) => p.trim().split(/\s+/))
        .filter((p) => p.length === 2 && p[0] && p[1])
        .map((p) => [p[0] as string, p[1] as string]),
    );
    return { stack: { language, framework, versions: v } };
  }, [mode, repo, files, language, framework, versions]);

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

  async function buildPlan() {
    setBusy(true);
    setError(null);
    const r = await productApi.plan(need.trim(), environment);
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
        : mode === "stack"
          ? ` Stack: ${language}${framework ? ` / ${framework}` : ""} (${versions}).`
          : ` Existing project files: ${Object.keys(files).join(", ")}.`;
    const r = await productApi.startBuild(`${need.trim()}${envLine}`);
    if (r.ok) return router.push(`/flows/${r.data.build_id}`);
    setBusy(false);
    setError(r.error ?? { message: "Generation could not start.", action: "Try again." });
  }

  const pendingApprovals = (plan?.needsApproval ?? []).filter((a) => !approved[a]);

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <ol aria-label="Steps" className="flex flex-col gap-3 text-sm">
        {["Describe the need", "Indicate your environment", "Review the plan"].map((label, i) => {
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
            <p className="text-bad">{error.message}</p>
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
          <Panel title="2 · Where will it live?">
            <div role="tablist" aria-label="Environment" className="flex flex-wrap gap-2">
              {(
                [
                  ["repo", "Connect a repository"],
                  ["upload", "Upload code"],
                  ["stack", "Pick stack & versions"],
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
              <div className="mt-5">
                <label htmlFor="repo" className="text-xs text-muted">
                  GitHub repository (owner/name)
                </label>
                <input
                  id="repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="acme/web-app"
                  className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 font-mono text-sm"
                />
                <p className="mt-2 text-xs text-muted">
                  Optional GitHub connection: it is only requested when you choose to integrate the
                  result as a pull request. Nothing is changed without your approval.
                </p>
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

            {mode === "stack" ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
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
                      <option key={l}>{l}</option>
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
                      <option key={f}>{f}</option>
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
                <p className="rounded-lg border border-amber/50 p-3 text-xs text-ice-2 sm:col-span-3">
                  With a stack only, you get a package verified for that stack. Adapting it to your
                  concrete project stays pending — connect a repository or upload code to have it
                  done for you.
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
              disabled={busy || pendingApprovals.length > 0 || Boolean(plan && !plan.compatible)}
              onClick={() => void generate()}
              className="rounded-full bg-amber px-6 py-2.5 text-sm font-semibold text-navy disabled:opacity-40"
            >
              {busy ? "Starting…" : "Generate & verify"}
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

function PlanReview({
  plan,
  approved,
  onApprove,
}: {
  plan: Plan;
  approved: Record<string, boolean>;
  onApprove: (a: string, v: boolean) => void;
}) {
  return (
    <>
      <Panel title="3 · Review one plan">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="display text-xl font-semibold text-cream">{plan.capability.name}</h3>
          <p className="text-xs text-muted">
            {plan.stack.framework ?? plan.stack.language} · detected from {plan.stack.source}
          </p>
        </div>
        {plan.stack.adaptationPending ? (
          <p className="mt-3 rounded-lg border border-amber/50 p-3 text-xs text-ice-2">
            Adaptation to your concrete project is pending: only a stack was given.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Estimate value={`~${plan.estimate.seconds} s`} label="Time to a verified package" />
          <Estimate
            value={plan.estimate.tokens.toLocaleString("en")}
            label="Tokens, only on new glue"
          />
          <Estimate
            value={String(plan.estimate.newLinesToMaintain)}
            label="New lines to maintain"
          />
          <Estimate value="Included" label="Cost during the invitation beta" />
        </div>
        {plan.incompatibilities.length > 0 ? (
          <ul className="mt-4 list-disc pl-5 text-sm text-bad">
            {plan.incompatibilities.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        {plan.missing.length > 0 ? (
          <p className="mt-3 text-sm text-amber">Not covered yet: {plan.missing.join(", ")}</p>
        ) : null}
      </Panel>

      <Panel title={`Decisions · why each component`}>
        <ul className="flex flex-col gap-3">
          {plan.decisions.map((d) => (
            <li key={d.topic} className="rounded-lg border border-line px-4 py-3 text-sm">
              <p className="font-mono text-xs text-muted">{d.topic}</p>
              <p className="mt-1 text-cream">{d.choice}</p>
              <p className="mt-1 text-ice-2">{d.why}</p>
              {d.alternatives.length > 0 ? (
                <p className="mt-1 text-xs text-muted">
                  Also considered: {d.alternatives.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title={`Files · ${plan.files.length}`}>
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {plan.files.map((f) => (
              <li key={f.path} title={f.why}>
                <span className={f.action === "add" ? "text-teal" : "text-amber"}>
                  {f.action === "add" ? "+" : "~"}
                </span>{" "}
                <span className="text-ice-2">{f.path}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Dependencies & configuration">
          <ul className="font-mono text-xs text-ice-2">
            {plan.dependencies.map((d) => (
              <li key={d.name}>
                {d.name}@{d.version}
              </li>
            ))}
          </ul>
          <ul className="mt-3 flex flex-col gap-1 text-xs">
            {plan.config.map((c) => (
              <li key={c.name}>
                <span className="font-mono text-ice-2">{c.name}</span>{" "}
                <span className="text-muted">— {c.why}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {plan.needsApproval.length > 0 ? (
        <Panel title="Needs your approval">
          <ul className="flex flex-col gap-2 text-sm">
            {plan.needsApproval.map((a) => (
              <li key={a}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(approved[a])}
                    onChange={(e) => onApprove(a, e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-ice-2">{a}</span>
                </label>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function Estimate({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-lg font-semibold text-cream">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

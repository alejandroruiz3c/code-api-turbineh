/**
 * What the flow is doing right now, in plain words, from the live trace (ADR-0051). Pure: the flow page, its tests and
 * any other client render the same lines. Nothing here is a model; every line comes from a worker event.
 */
import { currentRun, type TraceEvent } from "./flow-events";

export interface ProgressEvent extends TraceEvent {
  data: Record<string, unknown>;
  at: string;
}

/** "app": a complete app (gate: lint → typecheck → unit → build → E2E → security scans). "component": a package. */
export type RunKind = "app" | "component";

export type StepStatus = "done" | "current" | "next" | "pending" | "skipped";

export interface ProgressStep {
  key: string;
  label: string;
  status: StepStatus;
  /** Short note next to the step, e.g. "from your plan" or "verified inside your project". */
  note?: string;
}

export interface GateStep {
  name: string;
  label: string;
  state: "running" | "passed" | "failed";
  ms?: number;
  tests?: number;
}

export interface Progress {
  kind: RunKind;
  steps: ProgressStep[];
  /** The step running now (or waiting to start), with its plain-language line and live details. */
  current: { key: string; label: string; line: string; details: string[] } | null;
  next: string | null;
  gate: GateStep[];
  /** Since the run was queued. */
  elapsedMs: number;
  /** Since the last event of the run. */
  quietMs: number;
  /** Typical duration of the current step (median of recent flows), when known. */
  typicalMs: number | null;
  finished: boolean;
}

interface StepDef {
  key: string;
  label: string;
  phases: string[];
  optional?: boolean;
  /** Only for this kind of run. */
  only?: RunKind;
}

const STEPS: StepDef[] = [
  { key: "understand", label: "Understanding intent", phases: ["guarding", "compiling"] },
  { key: "select", label: "Orchestrating decisions", phases: ["selecting"] },
  { key: "resolve", label: "Checking compatibility", phases: ["resolving"], only: "app" },
  { key: "assemble", label: "Assembling verified components", phases: ["assembling"] },
  { key: "integrate", label: "Writing the glue", phases: ["integrating"], optional: true },
  { key: "verify", label: "Building, testing & scanning", phases: ["verifying"] },
  { key: "correct", label: "Correcting failed checks", phases: ["correcting"], optional: true },
  { key: "fix", label: "Fixing security findings", phases: ["remediating"], optional: true },
  { key: "report", label: "Writing the evidence", phases: ["reporting"], only: "app" },
  { key: "deliver", label: "Packaging", phases: ["delivering"] },
];

/** Gate checks in the order the page lists them. */
const GATE_LABEL: Record<string, string> = {
  install: "Installing dependencies",
  migrations: "Database migrations",
  lint: "Lint",
  typecheck: "Strict type check",
  unit: "Unit tests",
  build: "Production build",
  e2e: "End-to-end tests",
  scans: "Security scans (secrets, rules, vulnerabilities, licences)",
  contract: "Contract tests",
};
const GATE_ORDER = [
  "install",
  "migrations",
  "lint",
  "typecheck",
  "unit",
  "build",
  "e2e",
  "scans",
  "contract",
];

const list = (xs: unknown, max = 4): string => {
  const a = Array.isArray(xs) ? xs.map(String) : [];
  return a.length > max ? `${a.slice(0, max).join(", ")} and ${a.length - max} more` : a.join(", ");
};

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/** "~20 s", "~3 min": a rounded typical duration. */
export function about(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "under a second";
  if (s < 60) return `~${s} s`;
  return `~${Math.round(s / 60)} min`;
}

/** The live gate checks from `verifying step` events (latest verification round only). */
function gateOf(run: ProgressEvent[]): GateStep[] {
  const lastStart = run.findLastIndex((e) => e.phase === "verifying" && e.type === "start");
  const evs = run.slice(lastStart < 0 ? 0 : lastStart);
  const byName = new Map<string, GateStep>();
  for (const e of evs) {
    if (e.phase !== "verifying") continue;
    if (e.type === "step") {
      const name = String(e.data.name ?? "");
      if (!name) continue;
      const done = e.data.state === "done";
      byName.set(name, {
        name,
        label: GATE_LABEL[name] ?? name,
        state: done ? (e.data.ok === false ? "failed" : "passed") : "running",
        ...(typeof e.data.ms === "number" ? { ms: e.data.ms } : {}),
        ...(typeof e.data.tests === "number" && e.data.tests > 0 ? { tests: e.data.tests } : {}),
      });
    }
    if (e.type === "done" && Array.isArray(e.data.steps)) {
      // The round's final word: every check with its result.
      for (const s of e.data.steps as {
        name: string;
        ok: boolean;
        ms?: number;
        tests?: number;
      }[]) {
        const prev = byName.get(s.name);
        byName.set(s.name, {
          name: s.name,
          label: GATE_LABEL[s.name] ?? s.name,
          state: s.ok ? "passed" : "failed",
          ...(typeof s.ms === "number" ? { ms: s.ms } : {}),
          ...((s.tests ?? prev?.tests) ? { tests: s.tests ?? prev?.tests } : {}),
        });
      }
    }
  }
  return [...byName.values()].sort(
    (a, b) => GATE_ORDER.indexOf(a.name) - GATE_ORDER.indexOf(b.name),
  );
}

function gateLine(g: GateStep): string {
  const mark = g.state === "passed" ? "✓" : g.state === "failed" ? "✗" : "…";
  const extra = [
    g.tests ? `${g.tests} passed` : "",
    g.state === "running" ? "running" : g.ms !== undefined ? duration(g.ms) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `${mark} ${g.label}${extra ? ` · ${extra}` : ""}`;
}

/** Plain-language line and details of a step, from its events. */
function describe(
  key: string,
  evs: ProgressEvent[],
  kind: RunKind,
  gate: GateStep[],
): { line: string; details: string[] } {
  const last = (type: string) => evs.filter((e) => e.type === type).at(-1)?.data;
  switch (key) {
    case "understand":
      return {
        line: "Reading your need and turning it into a precise specification",
        details: [],
      };
    case "select": {
      const d = last("done") as { decisions?: unknown[]; selected?: unknown[] } | undefined;
      return {
        line: "Choosing a verified component for each capability",
        details: d?.selected
          ? [`Selected: ${list(d.selected)}`]
          : d?.decisions
            ? [`${d.decisions.length} capabilities decided`]
            : [],
      };
    }
    case "resolve":
      return { line: "Checking versions, licences and compatibility", details: [] };
    case "assemble": {
      const s = last("start") as { components?: unknown[] } | undefined;
      const d = last("done") as { files?: number } | undefined;
      const n = s?.components?.length ?? 0;
      return {
        line:
          n > 0
            ? `Assembling ${n} verified component${n === 1 ? "" : "s"}: ${list(s?.components)}`
            : "Assembling the verified components",
        details: d?.files !== undefined && kind === "app" ? [`${d.files} files written`] : [],
      };
    }
    case "integrate": {
      const s = last("start") as { components?: unknown[]; gaps?: unknown[] } | undefined;
      const progress = evs.filter((e) => e.type === "progress");
      const c = s?.components?.length ?? 0;
      const g = s?.gaps?.length ?? 0;
      const parts = [
        c ? `wiring ${c} component${c === 1 ? "" : "s"} (${list(s?.components, 3)})` : "",
        g ? `writing ${g} missing part${g === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      return {
        line: parts.length ? `Writing the glue: ${parts.join(" and ")}` : "Writing the glue",
        details: progress.length
          ? [`${progress.length} of ${g} missing part${g === 1 ? "" : "s"} written`]
          : [],
      };
    }
    case "verify": {
      const running = gate.filter((x) => x.state === "running").map((x) => x.label);
      const order =
        kind === "component"
          ? "install → contract tests → strict types"
          : "lint → type check → unit → build → end-to-end → security scans";
      return {
        line: running.length
          ? `Checking in an isolated sandbox: ${running.join(" and ")} now`
          : kind === "component"
            ? "Running the package's contract tests in an isolated sandbox"
            : "Running the gate in an isolated sandbox without internet",
        details: [`Order: ${order}`, ...gate.map(gateLine)],
      };
    }
    case "correct": {
      const s = last("start") as { attempt?: number } | undefined;
      return {
        line: s?.attempt
          ? `A check failed: correcting it (attempt ${s.attempt} of 3), then everything runs again`
          : "A check failed: correcting it, then everything runs again",
        details: [],
      };
    }
    case "fix":
      return {
        line: "Fixing security findings, then everything runs again",
        details: [],
      };
    case "report":
      return { line: "Writing the evidence: what works, what was checked, security", details: [] };
    case "deliver":
      return { line: "Packaging the result", details: [] };
    default:
      return { line: "Working", details: [] };
  }
}

/**
 * The progress of the latest run. `kind` comes from the flow (a capability package or a complete app); `typical` maps
 * a phase name to its median duration in recent flows.
 */
export function describeProgress(
  all: ProgressEvent[],
  opts: { kind: RunKind; now: number; typical?: Record<string, number>; finished?: boolean },
): Progress {
  const run = currentRun(all);
  const first = run[0];
  const generation = first?.type === "queued" && first.data.mode === "generate";
  const finished = opts.finished ?? run.some((e) => e.type === "finished");
  const gate = gateOf(run);
  // A finished plan run (no generation yet): only the planning steps happened, nothing was skipped.
  const planOnly =
    !generation &&
    finished &&
    !run.some((e) => ["assembling", "verifying", "delivering"].includes(e.phase));
  const defs = STEPS.filter((s) => !s.only || s.only === opts.kind).map((s) =>
    s.key === "verify" && opts.kind === "component"
      ? { ...s, label: "Running contract tests in the sandbox" }
      : s,
  );
  const evsOf = (d: StepDef) => run.filter((e) => d.phases.includes(e.phase));
  const seen = defs.map((d) => evsOf(d).length > 0);
  const lastSeen = seen.lastIndexOf(true);
  const steps: ProgressStep[] = [];
  let current: Progress["current"] = null;
  for (const [i, d] of defs.entries()) {
    const evs = evsOf(d);
    const doneEv = evs.some((e) => e.type === "done");
    // A generation run continues an approved plan: understanding and decisions happened in the plan run.
    if (generation && ["understand", "select", "resolve"].includes(d.key) && evs.length === 0) {
      steps.push({ key: d.key, label: d.label, status: "done", note: "from your plan" });
      continue;
    }
    if (evs.length === 0) {
      if (d.optional || planOnly) continue;
      if (finished || i < lastSeen) {
        steps.push({
          key: d.key,
          label: d.label,
          status: "skipped",
          note:
            d.key === "verify" && opts.kind === "component"
              ? "verified inside your project when you integrate it"
              : "not needed",
        });
        continue;
      }
      steps.push({ key: d.key, label: d.label, status: "pending" });
      continue;
    }
    // Later steps already started: this one is over even without its own "done" event.
    const over = doneEv || finished || i < lastSeen;
    steps.push({ key: d.key, label: d.label, status: over ? "done" : "current" });
    if (!over && !current)
      current = { key: d.key, label: d.label, ...describe(d.key, evs, opts.kind, gate) };
  }
  if (!finished && !current) {
    // Between two steps: the next pending one is what we are waiting for.
    const waiting = steps.find((s) => s.status === "pending");
    if (waiting) {
      waiting.status = "current";
      const d = defs.find((x) => x.key === waiting.key) as StepDef;
      current = { key: d.key, label: d.label, ...describe(d.key, [], opts.kind, gate) };
    } else if (run.length > 0 && run.at(-1)?.type === "queued") {
      current = {
        key: "queued",
        label: "Waiting for a worker",
        line: "Waiting for a free worker: it starts in a moment",
        details: [],
      };
    }
  }
  if (current) {
    const idx = steps.findIndex((s) => s.key === current.key);
    const nxt = steps.slice(idx + 1).find((s) => s.status === "pending");
    if (nxt) nxt.status = "next";
  }
  const startedAt = first ? Date.parse(first.at) : opts.now;
  const lastAt = run.length ? Date.parse(run.at(-1)?.at ?? "") : opts.now;
  const def = current ? defs.find((d) => d.key === current.key) : undefined;
  const typicalMs =
    def && opts.typical
      ? (def.phases.map((p) => opts.typical?.[p]).find((x) => typeof x === "number") ?? null)
      : null;
  return {
    kind: opts.kind,
    steps,
    current,
    next: steps.find((s) => s.status === "next")?.label ?? null,
    gate,
    elapsedMs: Math.max(0, opts.now - startedAt),
    quietMs: Math.max(0, opts.now - lastAt),
    typicalMs,
    finished,
  };
}

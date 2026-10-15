import type { FlowOutcome, FlowState } from "@turbineh/shared";
import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`animate-fade-up rounded-xl border border-line bg-panel/40 p-5 ${className}`}
    >
      {title ? <h2 className="eyebrow mb-3">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Precise states (PLAN §16.2): each means something different; nothing here says "ready". */
export const STATE_LABEL: Record<FlowState, { label: string; hint: string; tone: string }> = {
  planning: {
    label: "Planning",
    hint: "Reading the stack and choosing components",
    tone: "border-amber/60 text-amber",
  },
  planned: {
    label: "Planned",
    hint: "Plan built, not generated yet",
    tone: "border-line text-muted",
  },
  generating: {
    label: "Generating",
    hint: "Assembling and checking now",
    tone: "border-amber/60 text-amber",
  },
  generated: {
    label: "Delivered, not verified",
    hint: "Package produced; not every check passed — see what failed",
    tone: "border-amber/60 text-amber",
  },
  // F18 (ADR-0052): this state means the build checks passed; the request's requirements are counted apart.
  verified: {
    label: "Checks passed",
    hint: "Every build check passed in the TurbineH sandbox; requirements met are counted apart",
    tone: "border-teal/60 text-teal",
  },
  integrated: {
    label: "Integrated",
    hint: "Applied in your project, checks pending",
    tone: "border-amber/60 text-amber",
  },
  integration_verified: {
    label: "Integrated & verified",
    hint: "Checks also passed inside your project",
    tone: "border-teal/60 text-teal",
  },
  deployed: {
    label: "Deployed",
    hint: "Live in your own accounts",
    tone: "border-teal bg-teal/10 text-teal",
  },
  failed: {
    label: "Stopped",
    hint: "A check did not pass — see what to do",
    tone: "border-bad/60 text-bad",
  },
};

/** `label`/`hint` override the generic wording, e.g. a capability package that is "ready, not verified yet". */
export function StateBadge({
  state,
  label,
  hint,
}: {
  state: FlowState;
  label?: string;
  hint?: string;
}) {
  const s = STATE_LABEL[state];
  return (
    <span
      title={hint ?? s.hint}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${s.tone}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? s.label}
    </span>
  );
}

export function Stat({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel/30 p-4">
      <p className={`display text-2xl font-semibold ${accent ? "text-teal" : "text-cream"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

export const pct = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : `${Math.round(p * 100)}%`;
export const secs = (s: number | null | undefined) =>
  s === null || s === undefined
    ? "—"
    : s >= 120
      ? `${Math.round(s / 60)} min`
      : `${Math.round(s)} s`;

/**
 * F18 (ADR-0052): one state model for the web, the API and the CLI. The badge separates build checks from the
 * request's requirements ("Checks 11/11 · Requirements 6/8 met", from the engine's outcome); "verified" alone is never
 * shown while requirements are open.
 */
export function badgeOf(outcome: FlowOutcome | null): { label?: string; hint?: string } {
  if (!outcome) return {};
  if (outcome.kind === "package_unverified" || outcome.kind === "app_unverified")
    return {
      label: outcome.badge
        ? `Not verified · ${outcome.badge}`
        : outcome.kind === "package_unverified"
          ? "Package ready · not verified yet"
          : "Delivered, not verified",
      hint: outcome.title,
    };
  if (outcome.badge) return { label: outcome.badge, hint: outcome.title };
  return outcome.kind === "package_verified" ? { label: "Checks passed", hint: outcome.title } : {};
}

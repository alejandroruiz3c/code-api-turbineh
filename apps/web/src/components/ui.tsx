import type { FlowOutcome, FlowState } from "@turbineh/shared";
import { STATE_TEXT } from "@turbineh/shared/status-texts";
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

/**
 * Precise states (PLAN §16.2): each means something different; nothing here says "ready", and nothing says "verified"
 * without a qualifier (ADR-0063). Texts come from the shared status texts (one source for web, API, CLI and MCP).
 */
const TONE: Record<FlowState, string> = {
  planning: "border-amber/60 text-amber",
  planned: "border-line text-muted",
  generating: "border-amber/60 text-amber",
  generated: "border-amber/60 text-amber",
  verified: "border-teal/60 text-teal",
  integrated: "border-amber/60 text-amber",
  integration_verified: "border-teal/60 text-teal",
  deployed: "border-teal bg-teal/10 text-teal",
  failed: "border-bad/60 text-bad",
};
export const STATE_LABEL: Record<FlowState, { label: string; hint: string; tone: string }> =
  Object.fromEntries(
    (Object.keys(TONE) as FlowState[]).map((s) => [
      s,
      { label: STATE_TEXT[s].label, hint: STATE_TEXT[s].hint, tone: TONE[s] },
    ]),
  ) as Record<FlowState, { label: string; hint: string; tone: string }>;

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
 * F18 (ADR-0052), ADR-0063: one state model for the web, the API and the CLI. The badge is the engine's verdict line
 * ("Technically verified · checks 11/11 · functional 2/5"): build checks and functional coverage, never merged, and
 * "verified" alone only at or above the functional threshold.
 */
export function badgeOf(outcome: FlowOutcome | null): { label?: string; hint?: string } {
  if (!outcome) return {};
  if (outcome.badge) return { label: outcome.badge, hint: outcome.title };
  if (outcome.kind === "package_unverified" || outcome.kind === "app_unverified")
    return {
      label:
        outcome.kind === "package_unverified"
          ? "Package ready · not verified yet"
          : "Delivered, not verified",
      hint: outcome.title,
    };
  return outcome.kind === "package_verified" ? { label: "Checks passed", hint: outcome.title } : {};
}

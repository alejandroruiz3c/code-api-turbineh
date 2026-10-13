import type { FlowState } from "@turbineh/shared";
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
  verified: {
    label: "Package verified",
    hint: "Generated and verified in the TurbineH sandbox",
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

export function StateBadge({ state }: { state: FlowState }) {
  const s = STATE_LABEL[state];
  return (
    <span
      title={s.hint}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${s.tone}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
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

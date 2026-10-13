import type { Plan, PlanAction } from "@turbineh/shared";
import { Panel } from "./ui";

/**
 * Step 3 of /flows/new: one plan, starting with what the person gets and the next actions (ADR-0050). Pure (no
 * hooks), so it renders the same on the server, in the wizard and in tests.
 */
export function PlanReview({
  plan,
  approved,
  onApprove,
  onAction,
  busy = false,
  blockGenerate = false,
}: {
  plan: Plan;
  approved: Record<string, boolean>;
  onApprove: (a: string, v: boolean) => void;
  onAction: (a: PlanAction) => void;
  busy?: boolean;
  /** Decisions still to approve: only generation waits for them, the other choices stay available. */
  blockGenerate?: boolean;
}) {
  const standalone = plan.stack.source === "declared";
  const left =
    plan.left && plan.left.length > 0
      ? plan.left
      : plan.missing.map((m) => ({ part: m, why: "", where: "" }));
  return (
    <>
      <Panel title="3 · Review the plan">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="display text-xl font-semibold text-cream">{plan.capability.name}</h3>
          <p className="text-xs text-muted">
            {standalone
              ? "New project"
              : plan.stack.source === "repo"
                ? "From your repository"
                : "From your project files"}
          </p>
        </div>
        {plan.outcome ? (
          <section aria-label="What you get" className="mt-4 rounded-lg border border-teal/50 p-4">
            <p className="text-base font-semibold text-cream">{plan.outcome.title}</p>
            <p className="mt-2 text-sm text-ice-2">{plan.outcome.meaning}</p>
            {plan.outcome.notes.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                {plan.outcome.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              {plan.outcome.actions.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.detail}
                  disabled={busy || (blockGenerate && a.id === "generate")}
                  data-action={a.id}
                  onClick={() => onAction(a)}
                  className={
                    i === 0
                      ? "rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy disabled:opacity-40"
                      : "rounded-full border border-line px-4 py-2 text-sm text-ice-2 hover:border-teal disabled:opacity-40"
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{plan.outcome.actions[0]?.detail}</p>
          </section>
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
          <div className="mt-4 rounded-lg border border-amber/50 p-3">
            <p className="text-sm font-semibold text-amber">Before you continue</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ice-2">
              {plan.incompatibilities.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {left.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-cream">What is left after generation</p>
            <p className="text-xs text-muted">
              It never blocks generation: each part says where it is implemented.
            </p>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {left.map((l) => (
                <li key={l.part} className="rounded-lg border border-line px-3 py-2">
                  <span className="text-ice-2">{l.part}</span>
                  {l.why ? <span className="block text-xs text-muted">{l.why}</span> : null}
                  {l.where ? (
                    <span className="block text-xs text-teal">Where: {l.where}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      {plan.repository ? (
        <Panel title={`Your repository · ${plan.repository.repo}`}>
          <p className="text-sm text-cream">
            The capability goes to <code className="text-teal">{plan.repository.namespace}/</code>
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-ice-2">
            {plan.repository.conventions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {plan.repository.decisions.map((d) => (
              <li key={d.topic} className="rounded-lg border border-line px-3 py-2">
                <span className="font-mono text-xs text-muted">{d.topic}</span>{" "}
                <span className="text-cream">{d.choice}</span>
                <span className="block text-xs text-ice-2">{d.why}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

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
        <Panel title={`${standalone ? "What you receive" : "Files"} · ${plan.files.length}`}>
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {plan.files.map((f) => (
              <li key={f.path} title={f.why}>
                <span className={f.action === "add" ? "text-teal" : "text-amber"}>
                  {f.action === "add" ? "+" : "~"}
                </span>{" "}
                <span className="text-ice-2">{f.path}</span>
                {standalone ? <span className="block pl-3 text-muted">{f.why}</span> : null}
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

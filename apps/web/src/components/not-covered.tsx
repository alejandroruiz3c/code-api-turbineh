import type { NotCoveredExplanation } from "@turbineh/shared";

/** Prefix of the components-only choice in `needsApproval` (engine `COMPONENTS_ONLY_APPROVAL`; equality is tested). */
export const COMPONENTS_ONLY_APPROVAL = "Build verified components only, ";

/**
 * An uncovered request, explained (ADR-0062): what the library doesn't cover yet and why, the priority notice and
 * what TurbineH can do now — with the components-only offer when verified components serve part of it. Pure (no
 * hooks): the same on the plan screen, the wizard and a refused flow. The action (approve / build) is passed in.
 */
export function NotCovered({
  explanation,
  action,
}: {
  explanation: NotCoveredExplanation;
  action?: React.ReactNode;
}) {
  const offer = explanation.offer;
  return (
    <section
      aria-label="Not covered by the library"
      data-testid="not-covered-explanation"
      className="rounded-lg border border-amber/60 p-4"
    >
      <p className="text-sm font-semibold text-amber">{explanation.title}</p>
      {explanation.useCase ? (
        <p className="mt-1 text-sm text-ice-2">
          You asked for: <span className="text-cream">{explanation.useCase}</span>
        </p>
      ) : null}
      {explanation.notCovered.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-muted">Not covered yet:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ice-2" data-testid="not-covered">
            {explanation.notCovered.map((r) => (
              <li key={r.requirement}>
                {r.requirement} <span className="text-xs text-muted">— {r.why}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-3 text-sm text-ice-2">{explanation.priority}</p>
      <p className="mt-3 text-sm text-ice-2">
        <span className="text-muted">What we can do now:</span> {explanation.canDoNow}
      </p>
      {offer ? (
        <div className="mt-4 rounded-lg border border-teal/50 p-3" data-testid="component-offer">
          <p className="text-sm font-semibold text-cream">{offer.title}</p>
          <p className="mt-1 text-sm text-ice-2" data-testid="offer-you-get">
            {offer.youGet}
          </p>
          <p className="mt-1 text-sm text-amber" data-testid="offer-not-included">
            {offer.notIncluded}
          </p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {offer.components.map((c) => (
              <li key={c.id} className="rounded-lg border border-line px-3 py-2">
                <span className="font-mono text-xs text-teal">{c.id}</span>
                <span className="block text-xs text-muted">{c.does}</span>
                <span className="block text-xs text-ice-2">
                  {c.serves.length
                    ? `Gives ${c.gives} — for: ${c.serves.join(" · ")}`
                    : `Included because ${c.requiredBy ?? "another component"} requires it`}
                </span>
                {c.proof.map((p) => (
                  <span key={p.requirement} className="block text-[11px] text-muted">
                    Proved by: {p.test}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {offer.outOfScope.length > 0 ? (
            <>
              <p className="mt-3 text-xs text-muted">Out of scope (not built, never faked):</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-ice-2">
                {offer.outOfScope.map((r) => (
                  <li key={r.requirement}>{r.requirement}</li>
                ))}
              </ul>
            </>
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

import type { CatalogTotals, UseCase, UseCaseAddOn } from "@turbineh/engine";
import Link from "next/link";

/**
 * What each area of the library builds (ADR-0076), shared by the home and /catalog so both say the same: the area's
 * verified functions (canonical criteria linked to tests), the verified components that extend it, and the catalogue
 * totals. Everything comes from the engine's generated index (catalog/recipes + catalog/components); nothing here is
 * written by hand.
 */

export const discoverHref = (q: string) => `/discover?q=${encodeURIComponent(q)}`;

/** "171 verified components · 11 complete use cases · 195 functions proved by tests", computed from the catalogue. */
export function CatalogTotalsLine({ totals }: { totals: CatalogTotals }) {
  return (
    <p data-testid="catalog-totals" className="text-sm text-ice-2">
      <span className="text-cream">{totals.components}</span> verified components ·{" "}
      <span className="text-cream">{totals.useCases}</span> complete use cases ·{" "}
      <span className="text-cream">{totals.functions}</span> functions proved by tests
    </p>
  );
}

/** Chips of verified functions; `max` shows the first ones and a link to the rest. */
export function FunctionChips({
  label,
  functions,
  max,
  moreHref,
}: {
  label: string;
  functions: string[];
  max?: number;
  moreHref?: string;
}) {
  const shown = max ? functions.slice(0, max) : functions;
  const rest = functions.length - shown.length;
  return (
    <ul aria-label={label} className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((f) => (
        <li key={f} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ice-2">
          {f}
        </li>
      ))}
      {rest > 0 && moreHref ? (
        <li>
          <Link
            href={moreHref}
            className="inline-block rounded-full px-2.5 py-0.5 text-xs text-teal underline-offset-4 hover:underline"
          >
            +{rest} more
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/** "Extend with": the add-ons' names, each to its search in Discover (compact, for the home). */
export function AddOnLinks({ area, addOns }: { area: string; addOns: UseCaseAddOn[] }) {
  if (addOns.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-muted">
      <span className="text-ice-2">Extend with:</span>{" "}
      {addOns.map((a, i) => (
        <span key={a.id}>
          {i ? " · " : ""}
          <Link
            href={discoverHref(a.id)}
            title={a.tagline}
            aria-label={`${a.name} for ${area}: ${a.tagline}`}
            className="text-teal underline-offset-4 hover:underline"
          >
            {a.name}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** "Extend with": each add-on with its one line and its verified functions (for /catalog). */
export function AddOnList({ area, addOns }: { area: string; addOns: UseCaseAddOn[] }) {
  if (addOns.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="eyebrow">Extend with</p>
      <ul aria-label={`Extend ${area} with`} className="mt-2 space-y-3">
        {addOns.map((a) => (
          <li key={a.id}>
            <Link
              href={discoverHref(a.id)}
              className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
            >
              {a.name}
            </Link>
            <p className="text-xs text-muted">{a.tagline}</p>
            <p className="mt-1 text-xs text-ice-2">{a.functions.join(" · ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One area of the home's "What you can build". */
export function AreaCard({ u }: { u: UseCase }) {
  return (
    <li id={`area-${u.id}`} className="flex flex-col rounded-xl border border-line bg-panel/30 p-5">
      <h3 className="display text-lg font-semibold text-cream">{u.name}</h3>
      <p className="mt-1 text-sm text-muted">{u.tagline}</p>
      <FunctionChips
        label={`Verified functions of ${u.name}`}
        functions={u.functions}
        max={8}
        moreHref={`/catalog#${u.id}`}
      />
      <AddOnLinks area={u.name} addOns={u.addOns} />
    </li>
  );
}

import type { ProductHelp } from "@turbineh/engine";

/**
 * A question about TurbineH ("what can you do?", ADR-0069): what it builds, each use case with an example request the
 * library covers (one click fills the need). Same content as the API's `{ kind: "help" }`, the CLI and MCP; nothing was
 * planned or built.
 */
export function ProductHelpPanel({
  help,
  onPick,
}: {
  help: ProductHelp;
  onPick: (example: string) => void;
}) {
  return (
    <section
      aria-labelledby="product-help-title"
      data-testid="product-help"
      className="rounded-lg border border-teal/60 p-4 text-sm"
    >
      <h2 id="product-help-title" className="font-semibold text-cream">
        {help.title}
      </h2>
      <p className="mt-1 text-ice-2">{help.message}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {help.useCases.map((u) => (
          <li key={u.id}>
            <p className="text-ice-2">
              <span className="font-semibold">{u.name}</span>
              <span className="text-muted"> — {u.does}</span>
            </p>
            <button
              type="button"
              onClick={() => onPick(u.example)}
              className="mt-1 rounded-lg border border-line px-3 py-1.5 text-left text-xs text-ice-2 hover:border-teal"
            >
              Use this example: {u.example}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted">{help.components}</p>
    </section>
  );
}

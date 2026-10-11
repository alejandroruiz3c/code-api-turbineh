const curl = `curl -X POST https://software.turbineh.com/v1/builds \\
  -H "Authorization: Bearer $TURBINEH_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"An internal tool to track inventory with CSV import and export"}'

# → 202 {"build_id":"…","events_url":"/v1/builds/…/events"}

curl -N https://software.turbineh.com/v1/builds/$BUILD_ID/events \\
  -H "Authorization: Bearer $TURBINEH_API_KEY"`;

const ENDPOINTS: [method: string, path: string, description: string][] = [
  ["POST", "/v1/builds", "Queue a build from a prompt (Idempotency-Key supported)"],
  ["GET", "/v1/builds/{id}", "Status, metrics, artefact links, repository URL and documentation"],
  ["GET", "/v1/builds/{id}/events", "Live trace as Server-Sent Events"],
  ["POST", "/v1/builds/{id}/deliver", "Push to your GitHub (browser session)"],
  [
    "POST",
    "/v1/builds/{id}/improve",
    "Fix the remaining security alerts and deliver a new verified version",
  ],
  ["GET", "/v1/components", "Search the catalog"],
  ["GET", "/v1/components/{id}", "Component manifest"],
];

export default function Docs() {
  return (
    <main className="mx-auto max-w-4xl px-6 pt-8">
      <p className="eyebrow">API</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        Build apps from your own code
      </h1>
      <p className="mt-3 text-sm text-muted">
        The web app uses the same API. Errors follow RFC 9457. Machine-readable spec:{" "}
        <a className="text-teal underline" href="/v1/openapi.json">
          /v1/openapi.json
        </a>
        .
      </p>
      <table className="mt-8 w-full text-left text-sm">
        <tbody>
          {ENDPOINTS.map(([m, p, d]) => (
            <tr key={p + m} className="border-b border-line">
              <td className="py-2 pr-4 font-mono text-xs text-amber">{m}</td>
              <td className="py-2 pr-4 font-mono text-xs text-ice-2">{p}</td>
              <td className="py-2 text-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <pre className="prose-doc mt-8 overflow-auto rounded-xl border border-line bg-navy-900/70 p-5 text-ice-2">
        {curl}
      </pre>
    </main>
  );
}

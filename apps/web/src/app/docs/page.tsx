import type { Metadata } from "next";

export const metadata: Metadata = { title: "API · YES IF for Builders" };

const curl = `# Your invitation access token is your API key during the beta.
export TURBINEH_TOKEN=…                      # never commit it
H='Authorization: Bearer '"$TURBINEH_TOKEN"

# 1 · Search by need
curl -s "https://software.turbineh.com/v1/capabilities?q=booking%20agent" -H "$H"

# 2 · Plan for your environment (stack detected from your manifests)
curl -s -X POST https://software.turbineh.com/v1/plans -H "$H" -H "Content-Type: application/json" \\
  -d '{"need":"AI booking agent for a clinic","environment":{"files":{"package.json":"…"}}}'

# 3 · Generate and verify, then read the result (what works, what needs configuration)
curl -s -X POST https://software.turbineh.com/v1/plans/$PLAN_ID/generate -H "$H"
curl -s https://software.turbineh.com/v1/plans/$PLAN_ID -H "$H"`;

const ENDPOINTS: [method: string, path: string, description: string][] = [
  [
    "GET",
    "/v1/capabilities?q=",
    "Search by need: complete flows and verified components, requirements, examples",
  ],
  ["GET", "/v1/capabilities/{id}", "Inspect a capability: components, versions, compatibility"],
  [
    "POST",
    "/v1/plans",
    "Plan for your environment: components, files, dependencies, config, decisions, estimate",
  ],
  ["POST", "/v1/plans/{id}/generate", "Generate the package and verify it in the sandbox"],
  ["GET", "/v1/plans/{id}", "State and result: works, needs, checks, package, continue, revert"],
  ["GET", "/v1/activity", "Your workspace history and measured figures"],
  ["POST", "/v1/builds", "Complete flow from a description (Idempotency-Key supported)"],
  ["GET", "/v1/builds/{id}", "Flow status, evidence, package links and documents"],
  ["GET", "/v1/builds/{id}/events", "Live trace as Server-Sent Events"],
  [
    "POST",
    "/v1/builds/{id}/deliver",
    "Integrate into your GitHub repository (optional GitHub connection)",
  ],
  ["GET", "/v1/components", "Search verified components"],
  ["GET", "/v1/components/{id}", "Component manifest: provenance, version, licence, audit"],
];

export default function Docs() {
  return (
    <main className="mx-auto max-w-4xl px-6 pt-8">
      <p className="eyebrow">API</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        One engine for people and agents
      </h1>
      <p className="mt-3 text-sm text-muted">
        The web app, the API and the{" "}
        <a href="/cli" className="text-teal underline">
          CLI
        </a>{" "}
        share the same states and errors. Every error says what happened, what to do and how to
        resume. Send your access token as <code className="text-teal">Authorization: Bearer</code>;
        add <code className="text-teal">x-turbineh-workspace</code> to keep one history per project.
        Machine-readable spec:{" "}
        <a className="text-teal underline" href="/v1/openapi.json">
          /v1/openapi.json
        </a>
        .
      </p>
      <table className="mt-8 w-full text-left text-sm">
        <caption className="sr-only">Endpoints</caption>
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
      <h2 className="eyebrow mt-10">States</h2>
      <p className="mt-2 text-sm text-ice-2">
        <code>planned</code> → <code>generated</code> → <code>verified</code> (package verified in
        the sandbox) → <code>integrated</code> → <code>integration_verified</code> (checked inside
        your project) → <code>deployed</code>. Nothing is reported as ready while credentials or
        checks are missing.
      </p>
      <pre className="prose-doc mt-8 overflow-auto rounded-xl border border-line bg-navy-900/70 p-5 text-ice-2">
        {curl}
      </pre>
    </main>
  );
}

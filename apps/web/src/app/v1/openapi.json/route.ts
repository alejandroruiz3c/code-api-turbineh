/** OpenAPI 3.1 description of the public API. */
const spec = {
  openapi: "3.1.0",
  info: {
    title: "CODE-API-TURBINEH",
    version: "0.1.0",
    description: "Prompt to verified repository. Errors use RFC 9457 problem details.",
  },
  servers: [{ url: "https://software.turbineh.com" }],
  components: {
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description: "API key (tbh_…) or access token (TURBINEH_TOKEN)",
      },
    },
    schemas: {
      Problem: {
        type: "object",
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/v1/builds": {
      post: {
        summary: "Queue a build",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            schema: { type: "string" },
            description: "Retries with the same key return the same build",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompt"],
                properties: {
                  prompt: { type: "string", minLength: 20, maxLength: 20000 },
                  github_username: { type: "string" },
                  covered_only: {
                    type: "boolean",
                    description:
                      "Build only the covered part of a partially covered request (explicit choice). Uncovered requests are refused: use_case_not_covered.",
                  },
                  options: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Queued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    build_id: { type: "string", format: "uuid" },
                    status_url: { type: "string" },
                    events_url: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "422": { description: "Invalid prompt" },
          "429": { description: "Daily quota reached" },
          "503": { description: "Beta at capacity" },
        },
      },
    },
    "/v1/builds/{id}": {
      get: {
        summary: "Build status, metrics, artefact links, repository URL and docs",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Build" }, "404": { description: "Not found" } },
      },
    },
    "/v1/builds/{id}/events": {
      get: {
        summary: "Live trace (Server-Sent Events). Supports Last-Event-ID.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "text/event-stream" } },
      },
    },
    "/v1/builds/{id}/deliver": {
      post: {
        summary: "Push the build to the signed-in user's GitHub (session only)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "202": { description: "Delivery queued" },
          "409": { description: "Needs the GitHub repo scope" },
        },
      },
    },
    "/v1/builds/{id}/improve": {
      post: {
        summary:
          "Improve & redeliver: fix every remaining security alert, verify again and deliver a new build (the original is kept)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "202": { description: "Improvement build queued (returns the new build_id)" },
          "409": { description: "The original build is not finished" },
          "429": { description: "Daily build quota reached" },
        },
      },
    },
    "/v1/builds/{id}/deploy-app": {
      post: {
        summary:
          "Deploy for me (optional): deploy the build into your own Vercel account and database (Neon or an existing Postgres). Credentials are erased when the job ends.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "202": { description: "Deployment queued" },
          "409": { description: "Not finished or already running" },
        },
      },
      get: {
        summary: "Latest deployment: status, step, live URL",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Deployment status" } },
      },
    },
    "/v1/capabilities": {
      get: {
        summary: "Search verified capabilities (complete flows and components) for a need",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "{ query, total, results: CapabilitySummary[] }" } },
      },
    },
    "/v1/capabilities/{id}": {
      get: {
        summary: "Inspect a capability: components, requirements, compatibility, licences",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Capability detail" },
          "404": { description: "ProductError" },
        },
      },
    },
    "/v1/plans": {
      post: {
        summary: "Plan a need against your stack (nothing is generated)",
        description:
          'Body: { need (up to 20,000 characters: a full specification is accepted), environment: { repo | files | stack }, preferences?, generate?, components? }. Scope gate (ADR-0052): only use cases the library covers are planned. An uncovered need answers 422 `use_case_not_covered` with `notCovered` (the requirements not covered; the demand is recorded for a priority notice); a partially covered one returns a plan whose `scope.removed` lists what is out of scope and whose first `needsApproval` entry is the explicit choice to build only the covered part. `components: ["id", …]` (verified ids from /v1/components) plans exactly those components. `generate: true` continues into generation as soon as the plan needs no decision from a person. The plan carries `criteria`: each compiled acceptance criterion as covered (a shipped test will prove it) or open. Header x-turbineh-workspace keeps projects apart. Answers the Plan when ready within ~50 s (`?wait=0` returns at once with state "planning").',
        responses: {
          "200": { description: "Plan" },
          "202": { description: "{ id, state: planning, status_url }" },
          "4XX": { description: "ProductError { code, message, action, resume? }" },
        },
      },
    },
    "/v1/plans/{id}": {
      get: {
        summary: "Plan and flow result with precise states",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Plan fields + { state, plan, result: FlowResult }" } },
      },
    },
    "/v1/plans/{id}/generate": {
      post: {
        summary: 'Generate and verify the package; { "approve": true } acknowledges needsApproval',
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "202": { description: "{ id, state: generating }" },
          "409": { description: "ProductError" },
        },
      },
    },
    "/v1/plans/{id}/events": {
      get: {
        summary: "Live progress (Server-Sent Events)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "text/event-stream" } },
      },
    },
    "/v1/plans/{id}/package": {
      get: {
        summary:
          "Download the capability package (ZIP), ?format=manifest, or ?format=app (the complete verified application)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "ZIP or manifest.json" },
          "302": { description: "Signed URL" },
        },
      },
    },
    "/v1/plans/{id}/pull-request": {
      post: {
        summary:
          "Integrate the package into a repository of the connected GitHub account as a verified pull request",
        description:
          "Body: { repo?: owner/name (defaults to the plan's repository), base?: branch }. Runs in the background: analyse → adapt to the project's conventions → commits on turbineh/<capability> → draft PR → verification inside the project in the sandbox → ready for review (state integration_verified) only when every check passes. Never merged. Needs GitHub connected (409 github_not_connected otherwise).",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "202": { description: "{ integration: { id, status, phase, … }, status_url }" },
          "409": { description: "github_not_connected or package_not_ready (actionable error)" },
        },
      },
      get: {
        summary:
          "Repository integrations of the flow: phase, state, pull request, checks, what the reviewer configures",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "{ integrations: [...] }" } },
      },
    },
    "/v1/plans/{id}/integrations": {
      post: {
        summary:
          "Report an integration state (integrated, integration_verified, reverted, integration_failed)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "201": { description: "{ integration }" } },
      },
    },
    "/v1/repos": {
      get: {
        summary: "Repositories the connected GitHub account can write to (?q= filters by name)",
        responses: {
          "200": { description: "{ repos: [{ full_name, private, default_branch }] }" },
        },
      },
    },
    "/v1/repos/{owner}/{name}/analysis": {
      get: {
        summary:
          "Repository analysis: stack, router, src layout, aliases, ORM, auth, tests, CI, env file names; conflicts and decisions",
        parameters: [
          { name: "owner", in: "path", required: true, schema: { type: "string" } },
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "ref", in: "query", schema: { type: "string" } },
          {
            name: "app",
            in: "query",
            schema: { type: "string" },
            description: "App folder in a monorepo",
          },
        ],
        responses: { "200": { description: "{ analysis, conflicts, decisions, compatible }" } },
      },
    },
    "/v1/github": {
      get: {
        summary: "This workspace's GitHub connection (account, private access); never the token",
        responses: { "200": { description: "{ connected, login, private_repos, scopes, via }" } },
      },
      delete: {
        summary: "Disconnect GitHub: deletes the stored token and revokes the authorization",
        responses: { "200": { description: "{ removed, revoked_at_github }" } },
      },
    },
    "/v1/github/connect": {
      post: {
        summary:
          "One-time link (10 min) that runs Connect GitHub in a browser for this workspace (used by `turbineh connect github`)",
        responses: { "201": { description: "{ url, code, expires_in }" } },
      },
    },
    "/v1/github/token": {
      post: {
        summary:
          "Connect with an existing GitHub token (agents, CI); stored encrypted, never returned",
        responses: { "201": { description: "{ connected, login }" } },
      },
    },
    "/v1/activity": {
      get: {
        summary: "Your flows, states, time and tokens",
        responses: { "200": { description: "{ totals, flows }" } },
      },
    },
    "/v1/components": {
      get: {
        summary: "Search the catalog",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", default: "approved" } },
        ],
        responses: { "200": { description: "Components" } },
      },
    },
    "/v1/components/{id}": {
      get: {
        summary: "Component manifest",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Manifest (turbineh.component/v0.1)" } },
      },
    },
    "/health": {
      get: { summary: "Health", security: [], responses: { "200": { description: "OK" } } },
    },
  },
};

export function GET(): Response {
  return Response.json(spec);
}

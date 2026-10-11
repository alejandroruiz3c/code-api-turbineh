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
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key (tbh_…)" } },
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
                  prompt: { type: "string", minLength: 20, maxLength: 4000 },
                  github_username: { type: "string" },
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
    "/v1/components": {
      get: {
        summary: "Search the catalog",
        security: [],
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
        security: [],
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

import { describe, expect, it } from "vitest";
import {
  appSettings,
  checkConsistency,
  deployFacts,
  nextStepsFacts,
  reconcileManifest,
  DELIVERY_SCHEMA,
  type DeliveryManifest,
} from "./delivery.js";

const manifest = (over: Partial<DeliveryManifest> = {}): DeliveryManifest => ({
  schema: DELIVERY_SCHEMA,
  recipe: "bookings",
  approved: true,
  entries: [
    {
      capability: "domain.bookings",
      label: "bookings",
      way: "component",
      component: "domain.bookings.turbineh",
      justifiedBy: [{ kind: "use_case", ref: "bookings" }],
      status: "planned",
    },
    {
      capability: "ops.idempotency",
      label: "preventing the same action from running twice",
      way: "written",
      component: null,
      justifiedBy: [{ kind: "criterion", ref: "No double bookings" }],
      status: "planned",
    },
  ],
  criteria: ["No double bookings"],
  env: {
    required: [{ name: "DATABASE_URL", about: "" }],
    optional: [{ name: "EMAIL_FROM", about: "" }],
  },
  notSelected: [],
  brokenPromises: [],
  ...over,
});

describe("single env schema (F-11)", () => {
  it("src/env.ts decides, a refinement makes a setting required, component settings declare Required", () => {
    const env = appSettings({
      envTs: `const settings = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["a"]).default("a"),
  RESEND_API_KEY: z.string().optional(),
  ADMIN_EMAILS: z.string().default(""),
  TRUSTED_PROXY_HOPS: z.string().optional(),
});
ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "x" });`,
      envExample: `# Copy to .env.local for local development. Never commit real values.
# PostgreSQL
DATABASE_URL=x
RESEND_API_KEY=
# Optional: proxies
TRUSTED_PROXY_HOPS=
# Optional: staff
ADMIN_EMAILS=
# Required: staff who manage appointments
ADMIN_EMAILS=
# Required (unless AI_BASE_URL): token
TURBINEH_AI_TOKEN=
# Optional: model
AI_MODEL=
AI_API_KEY=`,
    });
    expect(env.required.map((e) => e.name)).toEqual([
      "DATABASE_URL",
      "RESEND_API_KEY",
      "ADMIN_EMAILS",
      "TURBINEH_AI_TOKEN",
    ]);
    expect(env.optional.map((e) => e.name)).toEqual([
      "TRUSTED_PROXY_HOPS",
      "AI_MODEL",
      "AI_API_KEY",
    ]);
    expect(env.required[0]?.about).toBe("PostgreSQL");
  });
});

describe("reconciliation and broken promises (F-03)", () => {
  it("an approved promise the package does not keep is a broken promise", () => {
    const m = reconcileManifest(manifest(), {
      components: ["domain.bookings.turbineh"],
      written: [],
      removed: {},
      env: manifest().env,
    });
    expect(m.brokenPromises.map((b) => b.capability)).toEqual(["ops.idempotency"]);
    expect(m.entries.find((e) => e.capability === "ops.idempotency")?.status).toBe("not_delivered");
  });

  it("a build nobody approved reports it as not included, not as a broken promise", () => {
    const m = reconcileManifest(manifest({ approved: false }), {
      components: ["domain.bookings.turbineh"],
      written: [],
      removed: {},
      env: manifest().env,
    });
    expect(m.brokenPromises).toEqual([]);
  });

  it("a component in the package without a decision is listed without justification (a contradiction)", () => {
    const m = reconcileManifest(manifest(), {
      components: ["domain.bookings.turbineh", "payments.checkout.stripe"],
      written: ["ops.idempotency"],
      removed: {},
      env: manifest().env,
    });
    expect(checkConsistency(m, []).map((c) => c.field)).toEqual(["justification"]);
  });
});

describe("consistency between surfaces", () => {
  const delivered = reconcileManifest(manifest(), {
    components: ["domain.bookings.turbineh"],
    written: [],
    removed: {},
    env: manifest().env,
  });

  it("flags settings, components, not-included and 'verified' that disagree with the manifest", () => {
    const deploy = deployFacts(
      `| Required | What it is |\n|---|---|\n| \`DATABASE_URL\` | x |\n\n| Optional | What it is |\n|---|---|\n| \`BETTER_AUTH_URL\` | x |\n`,
    );
    const out = checkConsistency(delivered, [
      deploy,
      {
        surface: "result",
        components: ["domain.bookings.turbineh", "ui.table.tanstack-table"],
        verified: true,
      },
      nextStepsFacts([
        "Not included in this version: bookings (domain.bookings). Add it yourself.",
        "Before deploying, set the required settings: `DATABASE_URL` (DEPLOY.md explains each one).",
      ]),
    ]);
    expect(out.map((c) => `${c.surface}:${c.field}`).sort()).toEqual([
      "DEPLOY.md:env.optional",
      "next steps:brokenPromises",
      "next steps:notIncluded",
      "next steps:notIncluded",
      "result:components",
      "result:verified",
    ]);
  });

  it("the same facts everywhere: no contradiction", () => {
    expect(
      checkConsistency(delivered, [
        { surface: "DEPLOY.md", envRequired: ["DATABASE_URL"], envOptional: ["EMAIL_FROM"] },
        nextStepsFacts([
          "Not delivered although the plan you approved promised it: preventing the same action from running twice (ops.idempotency). The package is not verified.",
          "Before deploying, set the required settings: `DATABASE_URL` (DEPLOY.md explains each one).",
        ]),
        {
          surface: "result",
          components: ["domain.bookings.turbineh"],
          criteria: ["No double bookings"],
          verified: false,
        },
      ]),
    ).toEqual([]);
  });
});

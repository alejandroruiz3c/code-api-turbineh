import { describe, expect, it } from "vitest";
import { appSettings, deployFacts } from "@turbineh/shared";
import { deployGuide, startHereHtml } from "./handover.js";

const envTs = `const settings = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  RESEND_API_KEY: z.string().optional(),
});
const schema = settings.superRefine((e, ctx) => {
  if (!e.RESEND_API_KEY) ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "x" });
});`;
const example = `DATABASE_URL=postgres://x
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000
# Transactional email via Resend
RESEND_API_KEY=
# Optional: secret for POST /api/jobs/run (background jobs).
JOBS_RUNNER_SECRET=
`;
const env = appSettings({ envTs, envExample: example });

describe("client handover", () => {
  it("lists exactly the settings of the app's env schema, required and optional (ADR-0064)", () => {
    const guide = deployGuide("App", env);
    expect(deployFacts(guide)).toEqual({
      surface: "DEPLOY.md",
      // RESEND_API_KEY: optional in Zod but required by a cross-setting rule of src/env.ts.
      envRequired: ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "RESEND_API_KEY"],
      envOptional: ["JOBS_RUNNER_SECRET"],
    });
  });

  it("adds the background-jobs step only when the app has a job queue", () => {
    expect(deployGuide("App", env)).toContain("Background jobs");
    expect(
      deployGuide("App", {
        ...env,
        optional: env.optional.filter((e) => e.name !== "JOBS_RUNNER_SECRET"),
      }),
    ).not.toContain("Background jobs");
  });

  it("escapes user-provided text in START_HERE.html and loads nothing external", () => {
    const html = startHereHtml({
      appName: "<script>alert(1)</script>",
      summary: "A & B",
      verified: true,
      checksPassed: 11,
      checksTotal: 11,
      criteriaVerified: 4,
      criteriaTotal: 5,
      alerts: 1,
      fixedBeforeDelivery: 0,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("AI apps: the TurbineH AI token is required and no provider or decider key is asked for", () => {
    const guide = deployGuide(
      "Support AI",
      appSettings({
        envTs: "",
        envExample:
          "DATABASE_URL=\nTURBINEH_AI_URL=https://software.turbineh.com/v1/ai\n# Required: token\nTURBINEH_AI_TOKEN=\n",
      }),
    );
    const required = guide.slice(guide.indexOf("| Required |"), guide.indexOf("| Optional |"));
    expect(required).toContain("`TURBINEH_AI_TOKEN`");
    expect(required).toContain("Get AI access token");
    expect(guide).not.toMatch(/TYPESAFE_API_KEY|AI_API_KEY/);
  });
});

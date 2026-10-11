import { describe, expect, it } from "vitest";
import { deployGuide, envVarsOf, startHereHtml } from "./handover.js";

const env = `DATABASE_URL=postgres://x
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000
# Optional: transactional email via Resend
RESEND_API_KEY=
# Optional: secret for POST /api/jobs/run (background jobs).
JOBS_RUNNER_SECRET=
`;

describe("client handover", () => {
  it("lists exactly the settings the app uses", () => {
    expect(envVarsOf(env).map((v) => v.key)).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "RESEND_API_KEY",
      "JOBS_RUNNER_SECRET",
    ]);
  });

  it("adds the background-jobs step only when the app has a job queue", () => {
    expect(deployGuide("App", env)).toContain("Background jobs");
    expect(deployGuide("App", env.replace(/.*JOBS.*\n/g, ""))).not.toContain("Background jobs");
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
});

/**
 * Client handover documents: DEPLOY.md (how to go live, only the settings this app uses) and START_HERE.html (a short,
 * non-technical entry point in TurbineH style that explains every document of the package). Written by code from
 * verified facts — no model text, no external resources.
 */

interface EnvVar {
  key: string;
  note: string;
}

const REQUIRED = new Set(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "ADMIN_EMAILS"]);
const EXPLAIN: Record<string, string> = {
  DATABASE_URL: "Connection string of your production PostgreSQL database.",
  BETTER_AUTH_SECRET:
    "Random secret of at least 32 characters (for example `openssl rand -base64 32`). Never reuse it.",
  BETTER_AUTH_URL: "The public address of the app, for example `https://app.yourcompany.com`.",
  ADMIN_EMAILS: "Comma-separated emails allowed to open the admin panel.",
  RESEND_API_KEY:
    "Resend API key to send real emails. Without it, emails are only written to the server log.",
  EMAIL_FROM:
    'Sender, for example `"Your App <hello@yourcompany.com>"` (domain verified in Resend).',
  JOBS_RUNNER_SECRET:
    "Random secret (32+ characters) that your scheduler sends to run background jobs.",
};

/** Keys and comments from the app's own .env.example. */
export function envVarsOf(envExample: string): EnvVar[] {
  const out: EnvVar[] = [];
  let comment = "";
  for (const raw of envExample.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      comment = line.replace(/^#\s*/, "");
      continue;
    }
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) out.push({ key: m[1], note: EXPLAIN[m[1]] ?? comment });
    comment = "";
  }
  return out;
}

export function deployGuide(appName: string, envExample: string): string {
  const vars = envVarsOf(envExample);
  const required = vars.filter((v) => REQUIRED.has(v.key));
  const optional = vars.filter((v) => !REQUIRED.has(v.key));
  const jobs = vars.some((v) => v.key === "JOBS_RUNNER_SECRET");
  const row = (v: EnvVar) => `| \`${v.key}\` | ${v.note} |`;
  return `# Deploy ${appName}

From this package to a live app your customers can use. Takes about 30 minutes the first time.

## 1 · What you need

- A **PostgreSQL** database (managed: Neon, Supabase, Scaleway, AWS RDS…).
- A **host for Node.js 24** (Vercel, Railway, Render, Fly.io, or your own server).
- Your **domain** (optional at first; the host gives you a temporary address).

## 2 · Settings (environment variables)

Set these in your host's dashboard. Never commit them to the repository.

| Required | What it is |
|---|---|
${required.map(row).join("\n")}
${optional.length ? `\n| Optional | What it is |\n|---|---|\n${optional.map(row).join("\n")}\n` : ""}
## 3 · Go live — option A: Vercel + Neon (simplest)

1. Push this repository to your GitHub (the "Push to my GitHub" button does it for you).
2. In Neon, create a project and copy its connection string → \`DATABASE_URL\`.
3. In Vercel: **Add New → Project →** import the repository. Framework: Next.js. Add the settings from step 2.
4. Create the tables once from your computer: \`pnpm install && DATABASE_URL="<your url>" pnpm db:migrate\`.
5. Deploy. Then set \`BETTER_AUTH_URL\` to the final address (your domain) and redeploy.

## 3 · Go live — option B: your own server

\`\`\`bash
pnpm install --frozen-lockfile
pnpm db:migrate        # with DATABASE_URL set
pnpm build
pnpm start --port 3000 # behind a reverse proxy with HTTPS (Caddy, Nginx)
\`\`\`
${
  jobs
    ? `
## 4 · Background jobs

This app runs work in the background. Ask your scheduler (Vercel Cron, a GitHub Action, or \`cron\`) to call every
minute:

\`\`\`bash
curl -X POST https://<your-app>/api/jobs/run -H "Authorization: Bearer $JOBS_RUNNER_SECRET"
\`\`\`
`
    : ""
}
## ${jobs ? "5" : "4"} · First steps in the app

1. Open the app and **sign up**: you become the owner of the first workspace.
2. Invite your team from the workspace settings and give each person the right role (owner, admin, member).
3. Check the **next steps** and any **alerts** in [TURBINEH_REPORT.md](TURBINEH_REPORT.md) before inviting customers.

## Keep it healthy

- Turn on **daily database backups** in your database provider.
- Add **error monitoring** (for example Sentry) and uptime checks.
- Keep dependencies updated (\`pnpm outdated\`); [SECURITY.md](SECURITY.md) lists any open advisories.
- When you change the data model: \`pnpm db:generate\`, commit the migration, then \`pnpm db:migrate\` on deploy.
`;
}

export interface HandoverFacts {
  appName: string;
  summary: string;
  verified: boolean;
  checksPassed: number;
  checksTotal: number;
  criteriaVerified: number;
  criteriaTotal: number;
  alerts: number;
  fixedBeforeDelivery: number;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** One self-contained page (inline CSS, no scripts, no external requests). */
export function startHereHtml(f: HandoverFacts): string {
  const docs: [string, string, string][] = [
    ["START_HERE.html", "This page", "What you received and where to begin."],
    [
      "TURBINEH_REPORT.md",
      "Your build report",
      "What was built, what was checked, and your next steps. Read it first.",
    ],
    ["DEPLOY.md", "Go-live guide", "How to put the app online for your customers, step by step."],
    [
      "SECURITY.md",
      "Security report",
      "Every security check we ran, what we fixed for you and what to watch.",
    ],
    ["README.md", "For your developer", "How to run the app on a computer and its quality checks."],
    ["COMPONENTS.md", "Building blocks", "The verified components your app is made of."],
    ["ARCHITECTURE.md", "How it fits together", "A one-page technical overview."],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.appName)} · Start here</title>
<style>
  :root { --navy:#001A5A; --navy-2:#0B2A73; --teal:#34D8C4; --amber:#F2B24B; --ice:#EAF2FF; --muted:#9FB0D4; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: var(--navy); color: var(--ice); line-height: 1.5; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 24px 64px; }
  .eyebrow { color: var(--teal); letter-spacing: .14em; text-transform: uppercase; font-size: 12px; font-weight: 700; }
  h1 { font-size: 34px; margin: 8px 0 8px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .status { display:flex; flex-wrap:wrap; gap:10px; margin: 0 0 32px; }
  .pill { border:1px solid var(--navy-2); background: rgba(255,255,255,.04); border-radius: 999px; padding: 6px 14px; font-size: 14px; }
  .ok { color: var(--teal); border-color: rgba(52,216,196,.4); }
  .warn { color: var(--amber); border-color: rgba(242,178,75,.4); }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  ol.steps { padding-left: 20px; margin: 0; }
  ol.steps li { margin: 6px 0; }
  .docs { display:grid; grid-template-columns: 1fr; gap: 10px; }
  .doc { border:1px solid var(--navy-2); border-radius: 12px; padding: 14px 16px; background: rgba(255,255,255,.03); }
  .doc b { color: var(--ice); } .doc code { color: var(--teal); font-size: 13px; }
  .doc p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
  .first { border-color: var(--teal); }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
  footer b { color: var(--teal); }
</style>
</head>
<body>
<main>
  <div class="eyebrow">TurbineH · Start here</div>
  <h1>${esc(f.appName)}</h1>
  <p class="lead">${esc(f.summary)}</p>
  <div class="status">
    <span class="pill ${f.verified ? "ok" : "warn"}">${f.verified ? "✓ Verified" : "Needs attention"}</span>
    <span class="pill ok">${f.checksPassed}/${f.checksTotal} automated checks passed</span>
    <span class="pill">${f.criteriaVerified}/${f.criteriaTotal} requirements proven by tests</span>
    ${f.fixedBeforeDelivery ? `<span class="pill ok">${f.fixedBeforeDelivery} security fix(es) applied for you</span>` : ""}
    <span class="pill ${f.alerts ? "warn" : "ok"}">${f.alerts ? `${f.alerts} alert(s) explained in the report` : "No open alerts"}</span>
  </div>

  <h2>Your app in 3 steps</h2>
  <ol class="steps">
    <li><b>Read your build report</b> — <code>TURBINEH_REPORT.md</code>: what you got and what to do next.</li>
    <li><b>Go live</b> with <code>DEPLOY.md</code>: database, settings, hosting. About 30 minutes.</li>
    <li><b>Sign up as the owner</b> in your live app and invite your team.</li>
  </ol>

  <h2>What is in this package</h2>
  <div class="docs">
${docs
  .map(
    ([file, title, what], i) =>
      `    <div class="doc${i === 1 ? " first" : ""}"><b>${title}</b> · <code>${file}</code><p>${what}</p></div>`,
  )
  .join("\n")}
    <div class="doc"><b>Your app's code</b> · <code>src/</code>, <code>tests/</code><p>Everything is yours: a complete Next.js app with sign-in, workspaces, roles and tests.</p></div>
  </div>

  <footer>Built and verified by <b>TurbineH</b> — selected from verified components, tested in an isolated sandbox before delivery.</footer>
</main>
</body>
</html>
`;
}

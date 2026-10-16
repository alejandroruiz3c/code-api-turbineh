import { TURBINEH_LOGO_SVG } from "./brand.js";

/**
 * Client handover documents: DEPLOY.md (how to go live, only the settings this app uses) and START_HERE.html (a short,
 * non-technical entry point in TurbineH style that explains every document of the package). Written by code from
 * verified facts — no model text, no external resources.
 */

/** Plain-language notes for well-known settings (shown instead of the .env.example comment). */
const EXPLAIN: Record<string, string> = {
  DATABASE_URL: "Connection string of your production PostgreSQL database.",
  BETTER_AUTH_SECRET:
    "Random secret of at least 32 characters (for example `openssl rand -base64 32`). Never reuse it.",
  BETTER_AUTH_URL: "The public address of the app, for example `https://app.yourcompany.com`.",
  ADMIN_EMAILS: "Comma-separated emails allowed to open the admin panel.",
  RESEND_API_KEY:
    "Resend API key to send emails (verification, invitations). Required in production: without it the app refuses to start, unless you set `EMAIL_DELIVERY=disabled` to run without email on purpose. Email links are never written to logs.",
  EMAIL_DELIVERY:
    "`disabled` runs the app without sending any email (no verification or invitation emails) until you add `RESEND_API_KEY`.",
  TRUSTED_PROXY_HOPS:
    "How many proxies in front of the app add the visitor's address to `X-Forwarded-For` (Vercel: leave empty; behind one Nginx/Caddy: `1`). Without it, per-visitor limits do not trust that header.",
  EMAIL_FROM:
    'Sender, for example `"Your App <hello@yourcompany.com>"` (domain verified in Resend).',
  JOBS_RUNNER_SECRET:
    "Random secret (32+ characters) that your scheduler sends to run background jobs.",
  TURBINEH_AI_TOKEN:
    "Your app's AI access token (`tbh_ai_…`): **Get AI access token** on your build page (Deploy for me sets it for you). The app uses TurbineH's AI — no AI provider or decider keys needed.",
  TURBINEH_AI_URL: "TurbineH AI address. Keep the default `https://software.turbineh.com/v1/ai`.",
};

/** A setting of the app's env schema (src/env.ts + declared component settings, ADR-0064). */
export interface EnvSetting {
  name: string;
  about: string;
}

/** The note DEPLOY.md shows for a setting. */
export const settingNote = (e: EnvSetting) => EXPLAIN[e.name] ?? e.about;

/**
 * DEPLOY.md from the app's single env schema (ADR-0064): the same Required / Optional split as the plan, the result,
 * AGENTS.md and turbineh.json.
 */
export function deployGuide(
  appName: string,
  env: { required: EnvSetting[]; optional: EnvSetting[] },
): string {
  const { required, optional } = env;
  const jobs = [...required, ...optional].some((v) => v.name === "JOBS_RUNNER_SECRET");
  const row = (v: EnvSetting) => `| \`${v.name}\` | ${settingNote(v).replace(/\|/g, "\\|")} |`;
  return `# Deploy ${appName}

From this package to a live app your customers can use. Takes about 30 minutes the first time.

> **Prefer us to do it?** On your build page, **Deploy for me** puts the app online in your own Vercel account and a
> new database for you in about 5 minutes, and updates this package with the live address. It is optional.

## 1 · What you need

- A **PostgreSQL** database (managed: Neon, Supabase, Scaleway, AWS RDS…).
- A **host for Node.js 24** (Vercel, Railway, Render, Fly.io, or your own server).
- Your **domain** (optional at first; the host gives you a temporary address).

## 2 · Settings (environment variables)

Set these in your host's dashboard. Never commit them to the repository.

${required.length ? `| Required | What it is |\n|---|---|\n${required.map(row).join("\n")}\n` : "No setting is required.\n"}
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
  /** Passed checks with non-blocking findings left (ADR-0065): shown as "with warnings", never as a plain pass. */
  checksWithWarnings?: number;
  criteriaVerified: number;
  criteriaTotal: number;
  alerts: number;
  fixedBeforeDelivery: number;
  /** Set when TurbineH deployed the app into the client's own accounts ("Deploy for me"). */
  live?: LiveInfo;
}

export interface LiveInfo {
  url: string;
  vercelProject: string;
  database: {
    provider: "neon" | "external";
    projectId?: string | undefined;
    region?: string | undefined;
  };
  settings: string[];
  cron: boolean;
  deployedAt: string;
  /** Vercel access came from the TurbineH integration (sign-in) instead of a pasted token. */
  viaIntegration?: boolean | undefined;
}

/** DEPLOYED.md: what TurbineH set up in the client's accounts and what is left for them to do. */
export function deployedGuide(appName: string, live: LiveInfo): string {
  const db =
    live.database.provider === "neon"
      ? `Neon project \`${live.database.projectId ?? ""}\` in ${live.database.region ?? "the EU"} (Frankfurt) — https://console.neon.tech`
      : "Your existing PostgreSQL database (the one you gave us)";
  return `# ${appName} is live

**${live.url}** — deployed for you on ${live.deployedAt.slice(0, 10)} into **your own accounts**. TurbineH keeps no access:
the credentials you gave us were used once and deleted.
${
  live.viaIntegration
    ? `
> **About the TurbineH integration in your Vercel account:** our access token was deleted after this deployment, so
> we cannot act on your account. Vercel may delete the settings an integration created when you uninstall it: before
> removing it (Vercel → Settings → Integrations), open your project → Settings → Environment Variables and re-save
> each value listed below as your own, then redeploy.
`
    : ""
}
## What we set up

| What | Where |
|---|---|
| Hosting | Vercel project \`${live.vercelProject}\` — https://vercel.com/dashboard (functions in the EU, \`fra1\`) |
| Database | ${db} |
| Tables | Created by the migrations, which ran inside your own Vercel build |
| Settings | ${live.settings.map((k) => `\`${k}\``).join(", ")} — stored encrypted in your Vercel project (secrets were generated at random and are not stored anywhere else) |
${live.cron ? "| Background jobs | Vercel Cron calls `/api/jobs/run` daily (Hobby plan limit); on Vercel Pro you can make it every minute in `vercel.json` |\n" : ""}
## What is left for you (about 15 minutes)

1. **Open your app** at ${live.url} and **sign up**: you become the owner of the first workspace.
2. **Invite your team** and give each person the right role.
3. **Your domain (optional):** Vercel → your project → Settings → Domains. Then set \`BETTER_AUTH_URL\` to the new
   address (Settings → Environment Variables) and redeploy.
4. **Emails:** create a Resend account, verify your domain and add \`RESEND_API_KEY\` and \`EMAIL_FROM\` in the same
   place, then remove \`EMAIL_DELIVERY\` and redeploy. Until then the app runs without email (\`EMAIL_DELIVERY=disabled\`):
   no verification or invitation emails are sent, and links are never written to the logs.
5. **Backups:** ${live.database.provider === "neon" ? "Neon keeps point-in-time history; check the retention of your plan." : "turn on daily backups in your database provider."}

## Changing the app later

Push this repository to your GitHub ("Push to my GitHub"), then in Vercel → your project → Settings → Git connect
that repository: every push deploys automatically. Migrations run on each deploy.

[DEPLOY.md](DEPLOY.md) still explains every setting if you ever move to another host.
`;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

interface DocCard {
  file: string;
  title: string;
  what: string;
  who: string;
  when: string;
}

const READ_FIRST: DocCard[] = [
  {
    file: "TURBINEH_REPORT.md",
    title: "Your build report",
    what: "What was built, which of your requirements are proven by tests, and your next steps.",
    who: "You",
    when: "Read first",
  },
  {
    file: "DEPLOY.md",
    title: "Go-live guide",
    what: "Database, settings and hosting, step by step, so your customers can use the app.",
    who: "You or your developer",
    when: "Before launch · ~30 min",
  },
  {
    file: "SECURITY.md",
    title: "Security report",
    what: "Every check we ran, what we fixed for you before delivery and what to keep an eye on.",
    who: "You",
    when: "Before inviting customers",
  },
];

const LIVE_CARD: DocCard = {
  file: "DEPLOYED.md",
  title: "Your live app",
  what: "The address of your app, what we set up in your accounts and the few steps left for you.",
  who: "You",
  when: "Now",
};

const FOR_DEVELOPERS: DocCard[] = [
  {
    file: "README.md",
    title: "Developer guide",
    what: "Run the app on a computer and its quality checks.",
    who: "Developer",
    when: "To change the app",
  },
  {
    file: "COMPONENTS.md",
    title: "Building blocks",
    what: "The verified components the app is made of, with versions and licences.",
    who: "Developer",
    when: "Reference",
  },
  {
    file: "ARCHITECTURE.md",
    title: "How it fits together",
    what: "A one-page technical overview.",
    who: "Developer",
    when: "Reference",
  },
  {
    file: "src/ · tests/",
    title: "The code",
    what: "A complete Next.js app with sign-in, workspaces, roles and tests. All of it is yours.",
    who: "Developer",
    when: "Always",
  },
];

const card = (d: DocCard, light: boolean) => {
  const link = d.file.includes(" ")
    ? `<span class="file">${esc(d.file)}</span>`
    : `<a class="file" href="${esc(d.file)}">${esc(d.file)} ↗</a>`;
  return `<article class="card${light ? " light" : ""}">
        <h3>${esc(d.title)}</h3>
        <p>${esc(d.what)}</p>
        <dl><div><dt>Who</dt><dd>${esc(d.who)}</dd></div><div><dt>When</dt><dd>${esc(d.when)}</dd></div></dl>
        ${link}
      </article>`;
};

/** One self-contained page in the api.turbineh.com style (inline CSS + inline logo, no scripts, no requests). */
export function startHereHtml(f: HandoverFacts): string {
  const pill = (text: string, tone: "ok" | "warn" | "plain") =>
    `<span class="pill ${tone}">${esc(text)}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.appName)} · Start here</title>
<style>
  :root { --navy:#001a5a; --navy-900:#00123f; --panel:#0a2a72; --panel-2:#123a8c; --line:#1f448f; --ice:#c0e5ff;
          --ice-2:#e1eaf3; --muted:#8fa6d4; --cream:#fcf6e4; --cream-2:#f3ead0; --ink:#0b1f5c; --ink-muted:#4a5f93;
          --ok:#7fd1a0; --warn:#f2b24b;
          --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--navy); color: var(--ice-2); font-family: var(--sans); line-height: 1.55;
         -webkit-font-smoothing: antialiased; }
  main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 72px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 40px; }
  .logo { height: 46px; width: auto; color: var(--ice); }
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: var(--muted); }
  .hero { border: 1px solid var(--line); background: rgba(10,42,114,.4); border-radius: 18px; padding: 36px; }
  h1 { font-size: clamp(30px, 5vw, 44px); line-height: 1.1; letter-spacing: -.02em; margin: 10px 0 10px; color: #fff; }
  .lead { color: var(--ice); margin: 0 0 22px; max-width: 70ch; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; border-radius: 999px;
          padding: 7px 14px; border: 1px solid var(--line); background: rgba(10,42,114,.5); color: var(--ice); }
  .pill.ok { color: var(--ok); border-color: rgba(127,209,160,.45); }
  .pill.warn { color: var(--warn); border-color: rgba(242,178,75,.45); }
  .pill.live { color: var(--navy); background: var(--ok); border-color: var(--ok); text-decoration: none; font-weight: 700; }
  section { margin-top: 48px; }
  h2 { font-size: 22px; margin: 8px 0 18px; color: #fff; letter-spacing: -.01em; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; counter-reset: s; list-style: none; padding: 0; margin: 0; }
  .steps li { border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 22px; counter-increment: s; }
  .steps li::before { content: "0" counter(s); display: block; font-family: var(--mono); font-size: 12px; letter-spacing: .2em; color: var(--muted); margin-bottom: 10px; }
  .steps li:first-child { background: var(--cream); color: var(--ink); border-color: var(--cream); }
  .steps li:first-child::before { color: var(--ink-muted); }
  .steps b { display: block; font-size: 17px; margin-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .grid.four { grid-template-columns: repeat(4, 1fr); }
  .card { display: flex; flex-direction: column; border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 22px; }
  .card.light { background: var(--cream); color: var(--ink); border-color: var(--cream); }
  .card h3 { margin: 0 0 6px; font-size: 17px; }
  .card p { margin: 0 0 14px; font-size: 14px; color: var(--ice); }
  .card.light p { color: var(--ink-muted); }
  dl { display: flex; gap: 18px; margin: 0 0 16px; }
  dt { font-family: var(--mono); font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
  .card.light dt { color: var(--ink-muted); }
  dd { margin: 2px 0 0; font-size: 13px; }
  .file { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 12px;
          color: var(--ice); text-decoration: none; }
  .steps .file { display: block; margin-top: 16px; }
  .steps li:first-child .file { color: var(--ink); border-color: var(--cream-2); }
  .card.light .file { border-color: var(--cream-2); color: var(--ink); }
  a.file:hover { text-decoration: underline; }
  footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; justify-content: space-between;
           gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  @media (max-width: 860px) { .steps, .grid, .grid.four { grid-template-columns: 1fr; } .hero { padding: 26px; } }
</style>
</head>
<body>
<main>
  <header>
    ${TURBINEH_LOGO_SVG}
    <span class="eyebrow">Start here</span>
  </header>

  <div class="hero">
    <span class="eyebrow">${f.live ? "Your app is live" : "Your app is ready"}</span>
    <h1>${esc(f.appName)}</h1>
    <p class="lead">${esc(f.summary)}</p>
    <div class="pills">
      ${f.live ? `<a class="pill live" href="${esc(f.live.url)}">● Live · ${esc(f.live.url.replace(/^https:\/\//, ""))} ↗</a>` : ""}
      ${pill(f.verified ? "✓ Verified" : "Needs attention", f.verified ? "ok" : "warn")}
      ${pill(`${f.checksPassed}/${f.checksTotal} checks passed${f.checksWithWarnings ? ` · ${f.checksWithWarnings} with warnings` : ""}`, f.checksPassed === f.checksTotal && !f.checksWithWarnings ? "ok" : "warn")}
      ${pill(`${f.criteriaVerified}/${f.criteriaTotal} requirements proven by tests`, "plain")}
      ${f.fixedBeforeDelivery ? pill(`${f.fixedBeforeDelivery} security fix(es) applied`, "ok") : ""}
      ${pill(f.alerts ? `${f.alerts} alert(s) explained` : "No open alerts", f.alerts ? "warn" : "ok")}
    </div>
  </div>

  <section>
    <span class="eyebrow">Three steps</span>
    <h2>From this package to your customers</h2>
    <ol class="steps">
      <li><b>Read your report</b>What you got, what is proven and what to do next. <a class="file" href="TURBINEH_REPORT.md">TURBINEH_REPORT.md ↗</a></li>
      ${
        f.live
          ? `<li><b>Your app is live</b>We set up hosting, database and settings in your accounts. <a class="file" href="DEPLOYED.md">DEPLOYED.md ↗</a></li>`
          : `<li><b>Go live</b>Database, settings and hosting in about 30 minutes — or let us do it with "Deploy for me". <a class="file" href="DEPLOY.md">DEPLOY.md ↗</a></li>`
      }
      <li><b>Invite your team</b>Sign up as the owner in your live app and add your team with the right roles.</li>
    </ol>
  </section>

  <section>
    <span class="eyebrow">Start with these</span>
    <h2>For you</h2>
    <div class="grid">
      ${(f.live ? READ_FIRST.map((d) => (d.file === "DEPLOY.md" ? LIVE_CARD : d)) : READ_FIRST)
        .map((d) => card(d, true))
        .join("\n      ")}
    </div>
  </section>

  <section>
    <span class="eyebrow">Technical</span>
    <h2>For your developer</h2>
    <div class="grid four">
      ${FOR_DEVELOPERS.map((d) => card(d, false)).join("\n      ")}
    </div>
  </section>

  <footer>
    <span>Built and verified by TurbineH — selected from verified components and tested in an isolated sandbox before delivery.</span>
    <span class="eyebrow">software.turbineh.com</span>
  </footer>
</main>
</body>
</html>
`;
}

import { checkLabel, summarizeUseCase, USE_CASES } from "@turbineh/engine";
import type { FlowState } from "@turbineh/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CopyBlock } from "../../components/copy-block";
import { STATE_LABEL } from "../../components/ui";

export const metadata: Metadata = {
  title: "How to use · YES IF for Builders",
  description:
    "Three ways to use YES IF for Builders by TurbineH: the web app for people, the CLI and MCP server for coding agents, and the API for any client app.",
};

const SITE = "https://software.turbineh.com";

/** The 11 checks every package passes in the TurbineH sandbox (packages/verifier StepName), labelled by the engine. */
const CHECKS = [
  "install",
  "migrations",
  "lint",
  "typecheck",
  "unit",
  "build",
  "e2e",
  "secrets",
  "static",
  "dependencies",
  "licenses",
] as const;

const STATE_ORDER: FlowState[] = [
  "planning",
  "planned",
  "generating",
  "generated",
  "verified",
  "integrated",
  "integration_verified",
  "deployed",
  "failed",
];

// ── Coding agents ────────────────────────────────────────────────────────────────────────────────────────────────

const INSTALL = `export TURBINEH_TOKEN=…   # the token from your invitation: keep it in the environment, never commit or print it
curl -fsSL ${SITE}/install.sh | sh`;

const INIT = `cd your-project
turbineh init --agent claude    # or: --agent codex · --agent cursor
turbineh init --yes             # any other agent: writes AGENTS.md`;

const BUILD = `turbineh build @spec.md --json          # or: turbineh build "<what to build>" --json
turbineh build @spec.md --json --timeout 30   # stop waiting after 30 minutes (default 20)
turbineh resume <id> --json             # after exit 4 or an interrupted call: keep waiting, then write
turbineh build @spec.md --json --approve      # after exit 3, only once the user agreed`;

const EVENTS = `{"event":"started","id":"<id>","target":"app","resume":"turbineh resume <id>"}
{"event":"plan_ready","id":"<id>","capability":{…},"components":[…],"criteria":{"covered":[…],"open":[…]},"settings":[…]}
{"ok":true,"command":"build",…}   ← the last line is the result`;

const LEFT = `turbineh left --json      # what is left: open criteria (each with where), gate, settings
turbineh verify --json    # fast checks with file:line and the fix
turbineh verify --full --json   # before handing over: the gate's security and policy checks, here`;

const REPO = `turbineh connect github                 # opens GitHub in the browser (public repositories)
turbineh connect github --private       # also private repositories (GitHub scope repo)
gh auth token | turbineh connect github --with-token   # or a token on stdin, never as an argument

turbineh plan "<need>"                   # plan only: components, files, dependencies, settings, criteria
turbineh apply --pr --repo owner/name --base main   # verified pull request on turbineh/… (never merged)
turbineh apply                           # or: locally, on a new branch, as one commit
turbineh revert                          # undo the last integration, keep later work`;

const MCP_CLAUDE = `claude mcp add turbineh -- turbineh mcp`;
const MCP_CODEX = `codex mcp add turbineh -- turbineh mcp`;
const MCP_CURSOR = `{
  "mcpServers": {
    "turbineh": { "command": "turbineh", "args": ["mcp"] }
  }
}`;

const MORE: [cmd: string, what: string][] = [
  ['turbineh search "<need>"', "Complete flows and verified components that cover a need"],
  ["turbineh inspect <id>", "What a capability includes, needs and was verified with"],
  ["turbineh status", "Flows, states, pending build and integrations"],
  [
    "turbineh login <token>",
    "Save the token instead of TURBINEH_TOKEN (it stays in your shell history)",
  ],
];

const EXIT_CODES: [code: string, meaning: string][] = [
  ["0", "Written, committed and green"],
  ["1", "Error (the message says what to do)"],
  ["2", "Usage"],
  ["3", "A decision for the user: show it, then re-run with --approve"],
  ["4", "Timeout: run the resume command it prints"],
  ["5", "Generation failed: rephrase the spec"],
  ["6", "Written and committed, but the gate is not green: read left"],
  ["7", "Local conflict: the message names the files"],
];

// ── API ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const API = `export TURBINEH_TOKEN=…                                  # your invitation token
export WS=$(uuidgen | tr 'A-Z' 'a-z')                     # one random workspace id per project; keep it
H1="Authorization: Bearer $TURBINEH_TOKEN"; H2="x-turbineh-workspace: $WS"

# Plan (and generate as soon as no person has to decide)
curl -s -X POST ${SITE}/v1/plans?wait=0 -H "$H1" -H "$H2" -H "Content-Type: application/json" \\
  -d '{"need":"Bookings for a physiotherapy clinic","environment":{},"generate":true}'

# State and result: works, needs, checks, package, continue, revert
curl -s ${SITE}/v1/plans/$PLAN_ID -H "$H1" -H "$H2"

# The package (ZIP), or a verified pull request on a connected repository
curl -sL -o package.zip ${SITE}/v1/plans/$PLAN_ID/package -H "$H1" -H "$H2"
curl -s -X POST ${SITE}/v1/plans/$PLAN_ID/pull-request -H "$H1" -H "$H2" \\
  -H "Content-Type: application/json" -d '{"repo":"owner/name","base":"main"}'`;

const CATALOG = `curl -s ${SITE}/catalog/llms.txt   -H "Authorization: Bearer $TURBINEH_TOKEN"
curl -s ${SITE}/catalog/index.json -H "Authorization: Bearer $TURBINEH_TOKEN"`;

const ENDPOINTS: [method: string, path: string, what: string][] = [
  ["GET", "/v1/capabilities?q=", "Search by need: complete flows and verified components"],
  ["GET", "/v1/capabilities/{id}", "Inspect a capability: components, requirements, licences"],
  ["POST", "/v1/plans", "Plan a need against your stack; generate: true continues on its own"],
  ["GET", "/v1/plans/{id}", "State and result: what works, what needs configuration, checks"],
  ["POST", "/v1/plans/{id}/generate", 'Generate and verify; { "approve": true } after a decision'],
  ["GET", "/v1/plans/{id}/events", "Live progress (Server-Sent Events)"],
  ["GET", "/v1/plans/{id}/package", "The package ZIP (?format=manifest, ?format=app)"],
  ["POST", "/v1/plans/{id}/pull-request", "Verified pull request on a connected GitHub repository"],
  ["POST", "/v1/builds", "Complete flow from a description (Idempotency-Key supported)"],
  ["GET", "/v1/builds/{id}", "Flow status, evidence, package links and documents"],
  ["GET", "/v1/activity", "Your workspace history"],
  ["GET", "/catalog/index.json", "Every verified component: does, use when, interfaces, example"],
  ["GET", "/catalog/llms.txt", "The same catalogue as a short text for models and agents"],
];

// ── Layout helpers ───────────────────────────────────────────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-16 scroll-mt-8">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`} className="display mt-2 text-2xl font-semibold text-cream">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted">{intro}</p>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-ice-2">{title}</h3>
      {children}
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-[12.5px] text-teal">{children}</code>
);

function Table({ caption, rows }: { caption: string; rows: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm sm:min-w-[480px]">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.join("|")} className="border-b border-line align-top">
              {r.map((cell, i) =>
                i === r.length - 1 ? (
                  <td key={i} className="py-2 text-muted">
                    {cell}
                  </td>
                ) : (
                  <td
                    key={i}
                    className={`whitespace-nowrap py-2 pr-4 font-mono text-xs ${i === 0 && r.length === 3 ? "text-amber" : "text-teal"}`}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOC: [id: string, label: string][] = [
  ["people", "People · web"],
  ["agents", "Coding agents · CLI & MCP"],
  ["api", "Any app · API"],
  ["build", "What you can build"],
];

export default function UsePage() {
  const useCases = USE_CASES.map((u) => summarizeUseCase(u));
  return (
    <main className="mx-auto max-w-4xl px-6 pt-8">
      <p className="eyebrow">How to use</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        YES IF for Builders by TurbineH
      </h1>
      <p className="mt-3 max-w-3xl text-sm text-muted">
        One engine — understand intent → orchestrate decisions → execute tasks — reached three ways:
        the web app for people, the CLI and MCP server for coding agents, and the API for any app.
        Same states, same errors, same verified packages.
      </p>

      <nav aria-label="On this page" className="mt-6">
        <ul className="flex flex-wrap gap-2 text-sm">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-block rounded-full border border-line px-4 py-1.5 text-ice-2 hover:border-teal"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="people"
        eyebrow="1 · People"
        title="In the web app"
        intro="Describe what you need; get verified code you can download or receive as a pull request."
      >
        <Sub title="Getting in">
          <p className="mt-2 text-sm text-ice-2">
            Open{" "}
            <a className="text-teal underline" href="/access">
              /access
            </a>{" "}
            and enter the access token from your invitation. Your browser keeps a signed cookie with
            a private workspace — never the token itself. Not invited yet?{" "}
            <a
              className="text-teal underline"
              href="https://api.turbineh.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the waitlist
            </a>
            .
          </p>
        </Sub>

        <Sub title="The flow">
          <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Describe", "New flow: the capability you need, in your words."],
              ["Plan", "Your environment, then one plan: components, files, settings, decisions."],
              ["Generate", "Live trace while the package is assembled, tested and scanned."],
              ["Verified result", "What works, and what still needs your configuration."],
              ["Integrate", "Download the ZIP, or receive a pull request on your repository."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-line bg-panel/30 p-4">
                <p className="eyebrow text-teal">Step {i + 1}</p>
                <p className="mt-1 font-semibold text-cream">{t}</p>
                <p className="mt-1 text-xs text-muted">{d}</p>
              </li>
            ))}
          </ol>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-ice-2">
            <li>
              <span className="text-cream">ZIP:</span> the package in its own folder, with a guide
              to integrate it by hand or with your coding agent.
            </li>
            <li>
              <span className="text-cream">Pull request:</span> choose “Connect GitHub”, pick a
              repository, and TurbineH adapts the package to your conventions, commits on a new{" "}
              <Code>turbineh/…</Code> branch, opens a pull request and verifies it inside your
              project. It never merges.
            </li>
            <li>
              <span className="text-cream">Private repositories are optional.</span> GitHub only
              lets an app open pull requests on private repositories with its broad{" "}
              <Code>repo</Code> permission; for public repositories the narrower{" "}
              <Code>public_repo</Code> is enough. Pick “include private repositories” only if you
              need it; disconnect at any time.
            </li>
            <li>
              <span className="text-cream">Then:</span> Check (security and reports), Continue (next
              steps and instructions for your coding agent) and Revert (one commit to undo, your
              later work stays).
            </li>
          </ul>
        </Sub>

        <Sub title="What every package contains">
          <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {[
              ["Working code", "A runnable app or capability, with sample data and tests."],
              [
                "Verification results",
                `The 11 checks in the TurbineH sandbox: ${CHECKS.map(checkLabel).join(" · ")}.`,
              ],
              [
                "AGENTS.md and turbineh.json",
                "What is done (with the test that proves it), what is left and where, what to re-run.",
              ],
              ["Docs", "README, architecture, security report and verification details."],
              [
                "Integration guide",
                "docs/integration.md, plus agent/INTEGRATE.md for coding agents.",
              ],
              [
                "Provenance",
                "Every component with its version, licence and source (COMPONENTS.md).",
              ],
              [
                "A clean revert",
                "It arrives as one commit or pull request: revert it, keep the rest.",
              ],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-line bg-panel/30 p-4">
                <p className="font-semibold text-cream">{t}</p>
                <p className="mt-1 text-xs text-muted">{d}</p>
              </li>
            ))}
          </ul>
        </Sub>

        <Sub title="States you will see">
          <ul className="mt-3 flex flex-col text-sm">
            {STATE_ORDER.map((s) => (
              <li key={s} className="flex flex-wrap gap-x-3 border-b border-line py-2">
                <code className="w-44 shrink-0 font-mono text-xs text-teal">{s}</code>
                <span className="text-cream">{STATE_LABEL[s].label}</span>
                <span className="text-muted">— {STATE_LABEL[s].hint}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ice-2">
            <span className="text-cream">Delivered, not verified: N/M checks passed.</span> If a
            check does not pass, you still receive the package, with the exact failures and the
            suggested fix shown first; it is never labelled verified.
          </p>
          <p className="mt-2 text-xs text-muted">
            Nothing is reported as ready while credentials or checks are missing.
          </p>
        </Sub>
      </Section>

      <Section
        id="agents"
        eyebrow="2 · Coding agents"
        title="Claude Code, Codex, Cursor — any agent that runs commands"
        intro="The CLI writes verified code into the project and tells the agent exactly what is left. Every command takes --json."
      >
        <Sub title="Install">
          <CopyBlock label="install commands" code={INSTALL} />
        </Sub>

        <Sub title="Set up the project">
          <CopyBlock label="init command" code={INIT} />
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-ice-2">
            <li>
              <Code>.turbineh/project.json</Code>: a random, private workspace id and the detected
              stack.
            </li>
            <li>
              An instructions block (when to use TurbineH, the one command, exit codes) in{" "}
              <Code>CLAUDE.md</Code> for Claude Code and in <Code>AGENTS.md</Code> for Codex, Cursor
              and any other agent. Without <Code>--agent</Code>, <Code>--yes</Code> writes it to the
              instructions file the project already has, or creates <Code>AGENTS.md</Code>; plain{" "}
              <Code>turbineh init</Code> only shows the block. Re-running refreshes it in place.
            </li>
            <li>
              Claude Code also gets the project skill <Code>.claude/skills/turbineh/SKILL.md</Code>.
            </li>
          </ul>
        </Sub>

        <Sub title="The one command">
          <CopyBlock label="build commands" code={BUILD} />
          <p className="mt-3 text-sm text-ice-2">
            Plans, generates, verifies, writes the code here and commits it. An empty folder gets
            the complete app; a JavaScript/TypeScript project gets the capability in its own folder.
            With <Code>--json</Code> it prints one JSON event per line; the last line is the result.
          </p>
          <CopyBlock label="example events" code={EVENTS} />
          <p className="mt-3 text-sm text-ice-2">
            In the result, <Code>criteria.items</Code> not <Code>met</Code> and <Code>left[]</Code>{" "}
            are the only work left, each with <Code>where</Code>; <Code>settings.missing</Code> go
            in <Code>.env.local</Code>; <Code>gate.ok</Code> means lint, types, unit, build and E2E
            already passed. Run it in the foreground with a long timeout (10 min): it returns as
            soon as the result is ready, so there is no need to poll.
          </p>
          <Table caption="Exit codes" rows={EXIT_CODES} />
        </Sub>

        <Sub title="Read what is left">
          <CopyBlock label="left and verify commands" code={LEFT} />
          <p className="mt-2 text-xs text-muted">
            Run them where the build wrote the code (the folder with <Code>turbineh.json</Code>).
          </p>
          <p className="mt-3 text-sm text-ice-2">
            <Code>verify --full</Code> runs the same security and policy checks as the TurbineH
            gate, with the same pinned versions: secret scan, our static rules, known
            vulnerabilities and the licence policy, plus typecheck, lint and unit tests. Each
            finding has its file and line, a security, policy or quality label and the fix; with{" "}
            <Code>--json</Code>, the same shape as the gate&apos;s findings. It uses Docker when it
            is available and pinned local binaries otherwise; a check that cannot run is reported as
            not run, never as clean. Your code never leaves the machine: only package names and
            versions are looked up. Exit 1 means a blocking finding or a check not run.
          </p>
        </Sub>

        <Sub title="Integrate into an existing repository">
          <CopyBlock label="repository commands" code={REPO} />
        </Sub>

        <Sub title="MCP">
          <p className="mt-2 text-sm text-ice-2">
            <Code>turbineh mcp</Code> is an MCP server on stdio. Its tools — build, resume, search,
            plan, apply, status, left, verify — return exactly the command&apos;s{" "}
            <Code>--json</Code> document. It uses the same token (<Code>TURBINEH_TOKEN</Code> or a
            saved login).
          </p>
          <p className="mt-4 text-xs text-muted">Claude Code</p>
          <CopyBlock label="Claude Code MCP command" code={MCP_CLAUDE} />
          <p className="mt-4 text-xs text-muted">Codex</p>
          <CopyBlock label="Codex MCP command" code={MCP_CODEX} />
          <p className="mt-4 text-xs text-muted">
            Cursor: <Code>.cursor/mcp.json</Code> in the project (or <Code>~/.cursor/mcp.json</Code>
            )
          </p>
          <CopyBlock label="Cursor MCP configuration" code={MCP_CURSOR} />
          <p className="mt-3 text-sm text-ice-2">
            Any MCP client: command <Code>turbineh</Code>, args <Code>mcp</Code>.
          </p>
        </Sub>

        <Sub title="More commands">
          <Table caption="More commands" rows={MORE} />
        </Sub>

        <Sub title="Rules for agents">
          <ul className="mt-3 flex list-disc flex-col gap-1 rounded-xl border border-teal/40 bg-teal/5 p-4 pl-9 text-sm text-ice-2">
            <li>
              Before writing a known capability yourself (shop and payments, auth and roles,
              bookings, AI assistants, dashboards, portals, CRUD, landing pages), run{" "}
              <Code>turbineh build</Code>.
            </li>
            <li>
              Always pass <Code>--json</Code> and branch on the exit code, not on the text.
            </li>
            <li>
              Never print, echo or commit the token; keep it in <Code>TURBINEH_TOKEN</Code>.
            </li>
            <li>
              In a delivered package, read <Code>AGENTS.md</Code> first; re-run only what your
              change touches.
            </li>
            <li>
              Before handing over, run <Code>turbineh verify --full --json</Code> and fix every
              blocking finding.
            </li>
            <li>Exit 3: show the decision to the user; add --approve only after they agree.</li>
          </ul>
        </Sub>
      </Section>

      <Section
        id="api"
        eyebrow="3 · Any app"
        title="The API"
        intro={
          <>
            Everything the web app and the CLI do, over HTTP. Errors are RFC 9457 problem details
            with <Code>code</Code>, <Code>message</Code>, <Code>action</Code> and, when it applies,{" "}
            <Code>resume</Code>. Machine-readable spec:{" "}
            <a className="text-teal underline" href="/v1/openapi.json">
              /v1/openapi.json
            </a>
            .
          </>
        }
      >
        <Sub title="Authentication and workspace">
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-ice-2">
            <li>
              <Code>Authorization: Bearer &lt;invitation token&gt;</Code> on every call.
            </li>
            <li>
              <Code>x-turbineh-workspace: &lt;id&gt;</Code> keeps one history per project. Use a
              random UUID: with a shared invitation token the workspace id is what keeps your flows
              and your GitHub connection apart, so GitHub can only be connected to a private
              workspace (a UUID), never to a guessable name or the shared default.
            </li>
          </ul>
          <CopyBlock label="API example" code={API} />
        </Sub>

        <Sub title="Main endpoints">
          <Table caption="Main endpoints" rows={ENDPOINTS} />
        </Sub>

        <Sub title="Catalogue index for agents">
          <p className="mt-2 text-sm text-ice-2">
            Every verified component — what it does and does not, when to use it, interfaces and a
            minimal example — with the same token.
          </p>
          <CopyBlock label="catalogue index commands" code={CATALOG} />
        </Sub>
      </Section>

      <Section
        id="build"
        eyebrow="4 · What you can build"
        title="Complete flows in the catalogue"
        intro="Each one is a verified app you can start from, or a capability added to your project. The same list answers turbineh search and /v1/capabilities."
      >
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {useCases.map((u) => (
            <li key={u.id} className="rounded-xl border border-line bg-panel/30 p-5">
              <h3 className="font-semibold text-cream">{u.name}</h3>
              <p className="mt-1 text-sm text-muted">{u.summary}</p>
              <p className="mt-3 text-xs text-ice-2">
                You provide:{" "}
                {u.requirements.map((r, i) => (
                  <span key={r.name}>
                    {i ? " · " : ""}
                    <code className="font-mono text-teal">{r.name}</code>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}

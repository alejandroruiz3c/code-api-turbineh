import type { Metadata } from "next";

export const metadata: Metadata = { title: "CLI · YES IF for Builders" };

const OPS: [cmd: string, what: string][] = [
  ['turbineh search "support agent"', "Find complete flows and verified components for a need"],
  ["turbineh inspect ai-agents", "Components, versions, compatibility and requirements"],
  [
    'turbineh plan "AI booking agent"',
    "Detect your stack and propose concrete changes before anything is applied",
  ],
  ["turbineh apply <plan>", "Apply on a new branch as one commit (or a pull request)"],
  ["turbineh verify", "Run the included checks inside your project"],
  ["turbineh revert <integration>", "Undo the integration without losing later work"],
  ["turbineh status", "Current state, what works and what needs configuration"],
];

const HUMAN = `$ turbineh plan "AI booking agent for a physiotherapy clinic"
✓ Stack detected   Next.js · TypeScript · pnpm · PostgreSQL
✓ Capability       AI agents & inference processes
  Files            + added · ~ modified (listed one by one)
  Dependencies     exact versions, licences checked
  Configuration    TURBINEH_AI_TOKEN (needed) · DATABASE_URL (found)
  Estimate         time · tokens on new glue only · new lines to maintain
! Needs approval   adds a "bookings" table (migration)
→ Next: turbineh apply <plan> --approve migration`;

const JSON_OUT = `$ turbineh status --json
{
  "planId": "pl_7Hc2",
  "state": "integrated",
  "works": ["Package verified in the sandbox: 11/11 checks"],
  "needs": [{ "kind": "env", "name": "TURBINEH_AI_TOKEN", "satisfied": false,
              "why": "Your app's access to TurbineH AI" }],
  "errors": [{ "code": "missing_env",
               "message": "TURBINEH_AI_TOKEN is not set.",
               "action": "Set TURBINEH_AI_TOKEN in .env.local",
               "resume": "turbineh verify --resume pl_7Hc2" }]
}`;

export default function CliPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 pt-8">
      <p className="eyebrow">CLI · for people and coding agents</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        Inside your repository, where the work happens
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        One command installs the tool and proposes the project instructions for Claude Code or
        Codex. Readable output for people, structured output for agents — the same state and the
        same errors.
      </p>

      <section className="mt-8">
        <h2 className="eyebrow">Install</h2>
        <pre className="prose-doc mt-3 overflow-auto rounded-xl border border-line bg-navy-900/70 p-5 text-ice-2">
          {`curl -fsSL https://software.turbineh.com/install.sh | sh
turbineh init        # asks for your access token, writes .turbineh/project.json
                     # and proposes the instructions for CLAUDE.md / AGENTS.md`}
        </pre>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">The workflow</h2>
        <p className="mt-2 text-sm text-ice-2">search → inspect → plan → apply → verify → revert</p>
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Commands</caption>
          <tbody>
            {OPS.map(([c, w]) => (
              <tr key={c} className="border-b border-line">
                <td className="py-2 pr-4 font-mono text-xs text-teal">{c}</td>
                <td className="py-2 text-muted">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Add <code className="text-teal">--json</code> to any command for your agent. Project
          preferences (stack, approved components, conventions, change policy) live in{" "}
          <code>.turbineh/project.json</code> and are reused on every run, so you are not asked
          twice.
        </p>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="eyebrow">For people</h2>
          <pre className="prose-doc mt-3 overflow-auto rounded-xl border border-line bg-navy-900/70 p-4 text-[11.5px] text-ice-2">
            {HUMAN}
          </pre>
        </div>
        <div>
          <h2 className="eyebrow">For your coding agent</h2>
          <pre className="prose-doc mt-3 overflow-auto rounded-xl border border-line bg-navy-900/70 p-4 text-[11.5px] text-ice-2">
            {JSON_OUT}
          </pre>
        </div>
      </section>
      <p className="mt-6 text-xs text-muted">
        An error never just says “something went wrong”: it says what is missing, how to fix it and
        where to resume.
      </p>
    </main>
  );
}

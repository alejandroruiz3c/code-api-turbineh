import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/**
 * What a coding agent reads about TurbineH without being told (ADR-0036): a short block in CLAUDE.md / AGENTS.md and,
 * for Claude Code, a project skill. Every line saves the agent a step: when to use it, the one command, how to read
 * what is left, and what each exit code means. Nothing else.
 */

export type AgentKind = "claude" | "codex" | "cursor";

const START = "<!-- turbineh:start -->";
const END = "<!-- turbineh:end -->";

export const AGENT_BLOCK = `${START}
## TurbineH

Verified, already-tested code for common capabilities (shop + payments, auth/roles, bookings, AI assistants, admin
dashboards, client portals, CRUD SaaS, landing pages). Before writing one of these yourself:

- \`turbineh build "<spec>" --json\` (or \`turbineh build @spec.md --json\`): plans, generates, verifies, writes the code
  here and commits it. Empty folder → whole app; existing project → its own folder. Takes 2–4 min: use a 600000 ms
  timeout or run it in the background. First line \`plan_ready\` lists \`criteria.open\`; the last line is the result.
- In the result, \`criteria.items\` not \`met\` and \`left[]\` are the only work left (each with \`where\`);
  \`settings.missing\` go in \`.env.local\`. \`gate.ok\` = lint, types, unit, build, E2E already passed: don't re-run all.
- Later: \`turbineh left --json\` (what is left), \`turbineh verify --json\` (checks with file:line and fix).
- Exit: 0 green · 3 ask the user, then \`--approve\` · 4 timeout → \`turbineh resume <id> --json\` · 5 failed · 6 gate
  not green · 7 local conflict (message names the files).
${END}
`;

/** Claude Code project skill (.claude/skills/turbineh/SKILL.md): frontmatter fields from the Claude Code docs. */
export function skillMarkdown(url: string): string {
  return `---
name: turbineh
description: Get verified, already-tested code for a known capability instead of writing it — online shop with Stripe payments, auth and roles, bookings and scheduling, AI assistants and agents, admin dashboards, client portals, CRUD SaaS, landing pages. Use before implementing such a feature, when starting an app from a spec, or to see what is left in a TurbineH package.
allowed-tools: Bash(turbineh *)
---

# TurbineH

1. \`turbineh build "<spec>" --json\` — or \`turbineh build @spec.md --json\` for a spec file (full text, up to 20,000
   characters). Empty folder → complete app; existing project → the capability in its own folder, adapted to the
   project. It writes the files and commits them: no download, clone, copy or commit for you to do.
2. It takes 2–4 minutes: give the Bash call \`timeout: 600000\` or run it in the background. The first line
   (\`"event":"plan_ready"\`) lists \`criteria.open\`: plan those while it builds. The last line is the result.
3. Result: criteria in \`criteria.items\` whose \`status\` is not \`met\`, and \`left[]\`, are the only work left, each with
   \`where\` (files) — start there. \`settings.missing\` → \`.env.local\` (\`.env.example\` documents them).
   \`gate.ok: true\` means lint, typecheck, unit, build and E2E already passed: re-run only what your change touches.
4. After your changes: \`turbineh verify --json\` (failures with file:line and the fix); \`turbineh left --json\` re-reads
   what is left.

Exit codes: 0 green · 2 usage · 3 a decision for the user (re-run with \`--approve\` once they agree) · 4 still
running → \`turbineh resume <id> --json\` (also after an interrupted call) · 5 generation failed (rephrase the spec) ·
6 committed but the gate is not green · 7 local conflict (the message names the files).

Not installed: \`curl -fsSL ${url}/install.sh | sh\` (token in \`TURBINEH_TOKEN\`).
`;
}

/**
 * How the agent should invoke the CLI on this machine: \`turbineh\` when it is on PATH, otherwise the installed
 * wrapper's absolute path (e.g. a container where ~/.turbineh/bin is not on PATH and the agent's shell is fresh on
 * every call), so the written instructions work as is.
 */
export function cliCommand(path = process.env.PATH ?? "", script = process.argv[1] ?? ""): string {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, "turbineh"), constants.X_OK);
      return "turbineh";
    } catch {
      // not here
    }
  }
  const wrapper = join(dirname(script), "turbineh");
  return script.endsWith("turbineh.mjs") && existsSync(wrapper) ? wrapper : "turbineh";
}

/** The instructions with the command as this machine needs it. */
export const withCommand = (text: string, cmd: string) =>
  cmd === "turbineh"
    ? text
    : text.replace(/`turbineh /g, `\`${cmd} `).replace("Bash(turbineh *)", `Bash(${cmd} *)`);

export const SKILL_PATH = join(".claude", "skills", "turbineh", "SKILL.md");

/** Instruction file per agent: Claude Code reads CLAUDE.md; Codex and Cursor read AGENTS.md. */
export function instructionFile(cwd: string, agent: AgentKind | null): string {
  if (agent === "claude") return "CLAUDE.md";
  if (agent) return "AGENTS.md";
  return existsSync(join(cwd, "CLAUDE.md"))
    ? "CLAUDE.md"
    : existsSync(join(cwd, "AGENTS.md"))
      ? "AGENTS.md"
      : "CLAUDE.md";
}

/** Inserts or refreshes the block (between its markers); an older unmarked TurbineH section is replaced too. */
export function upsertBlock(text: string, block = AGENT_BLOCK): string {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s !== -1 && e > s)
    return `${text.slice(0, s)}${block.trimEnd()}${text.slice(e + END.length)}`;
  const legacy = /## TurbineH capabilities\n[\s\S]*?(?=\n## |\s*$)/.exec(text);
  if (legacy)
    return `${text.slice(0, legacy.index)}${block.trimEnd()}${text.slice(legacy.index + legacy[0].length)}\n`;
  return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${block}`;
}

export function writeAgentFiles(
  cwd: string,
  agent: AgentKind | null,
  url: string,
  cmd = "turbineh",
): { file: string; changed: boolean; skill: string | null } {
  const file = instructionFile(cwd, agent);
  const p = join(cwd, file);
  const before = existsSync(p) ? readFileSync(p, "utf8") : "";
  const after = upsertBlock(before, withCommand(AGENT_BLOCK, cmd));
  if (after !== before) writeFileSync(p, after);
  let skill: string | null = null;
  if (agent === "claude") {
    const sp = join(cwd, SKILL_PATH);
    mkdirSync(dirname(sp), { recursive: true });
    writeFileSync(sp, withCommand(skillMarkdown(url), cmd));
    skill = SKILL_PATH;
  }
  return { file, changed: after !== before, skill };
}

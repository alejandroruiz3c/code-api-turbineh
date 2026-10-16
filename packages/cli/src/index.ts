import { createInterface } from "node:readline/promises";
import type { Ctx } from "./commands.js";
import { VERSION } from "./context.js";
import { serve } from "./mcp.js";
import { print } from "./output.js";
import { runCommand } from "./registry.js";

const HELP = `turbineh ${VERSION} — verified software capabilities for people and coding agents

  turbineh build "<spec>" | @spec.md  spec → verified code written and committed here (empty folder: whole app;
                                    project: capability in its own folder) + summary of what is left
         [--approve] [--timeout <min>] [--components id,id] [--json]
                                    only covered use cases are built: an uncovered one is refused with why
                                    (use_case_not_covered, exit 5) or, when verified components serve part of
                                    it, offered as a components-only package (components_only_offer, exit 3;
                                    --approve builds only those components); --components builds exactly these
  turbineh resume [id]              keep waiting for a build that timed out or was interrupted, then write it
  turbineh status [id]              flows, states, pending build and integrations
  turbineh left                     in a delivered package: what is left (open criteria with where, gate, settings)
  turbineh verify [integration]     fast checks with file:line and the fix
  turbineh verify --full [--offline] [--skip-scripts]
                                    before handing over: the gate's security and policy checks here, same pinned
                                    versions (gitleaks, Semgrep rules, OSV, licences; Docker, else local binaries)
                                    + typecheck, lint, unit; exit 1 on a blocking finding or a check not run
  turbineh init [--agent claude|codex|cursor]
                                    project file + instructions for the agent (+ Claude Code skill)
  turbineh mcp                      MCP server on stdio: claude mcp add turbineh -- turbineh mcp
  turbineh search "<need>"          capabilities and components that cover a need
  turbineh inspect <id>             what a capability includes, needs and was verified with
  turbineh plan "<need>" [--components id,id]
                                    plan only: components, files, deps, settings, criteria, cost
  turbineh apply [plan] [--approve] generate a plan, integrate it on a new branch (one commit)
  turbineh apply [plan] --pr [--repo owner/name] [--base branch]
                                    verified pull request on your GitHub repository
  turbineh connect github [--private] [--with-token]   ·   turbineh disconnect github
  turbineh revert [integration]     undo one integration, keep later work
  turbineh login [--with-token]     save your invitation token: typed without echo, or piped on stdin with
                                    --with-token (or set TURBINEH_TOKEN); never as an argument

  --json   structured output for coding agents (build/resume: one JSON event per line, the last line is the result)
  --yes    do not ask for confirmation (respects .turbineh/project.json policy)

  Exit codes: 0 ok · 1 error · 2 usage · 3 needs the user's decision (--approve; incl. components_only_offer)
              · 4 timeout (resume)
              5 generation failed · 6 written, gate not green · 7 local conflict
`;

export function parse(argv: string[]): {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
} {
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--no-")) flags[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (v !== undefined) flags[k] = v;
      else if (
        ["url", "stack", "limit", "resume", "repo", "base", "agent", "spec", "timeout"].includes(
          k,
        ) &&
        next &&
        !next.startsWith("--")
      ) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else args.push(a);
  }
  return { cmd: args.shift() ?? "help", args, flags };
}

async function main(): Promise<number> {
  const { cmd, args, flags } = parse(process.argv.slice(2));
  const json = flags.json === true;
  if (cmd === "help" || flags.help || cmd === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === "version" || flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cmd === "mcp") {
    process.env.TURBINEH_CLI_SURFACE = "mcp";
    await serve();
    return 0;
  }
  const streaming = json && (cmd === "build" || cmd === "resume");
  const ctx: Ctx = {
    cwd: process.cwd(),
    args,
    flags,
    json,
    confirm: async (q) => {
      if (!process.stdin.isTTY) return false;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(q);
      rl.close();
      return /^y(es)?$/i.test(a.trim());
    },
    // --json: one compact line per event, then the result line (NDJSON); humans get the few progress lines only.
    ...(streaming ? { emit: (e) => process.stdout.write(`${JSON.stringify(e)}\n`) } : {}),
  };
  const { result, exitCode } = await runCommand(cmd, ctx);
  print(result, json, streaming);
  return exitCode;
}

if (!process.env.VITEST) process.exitCode = await main();

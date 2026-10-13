import { createInterface } from "node:readline/promises";
import {
  apply,
  init,
  inspect,
  left,
  login,
  plan,
  revert,
  search,
  status,
  verify,
  type Ctx,
} from "./commands.js";
import { CliError, VERSION } from "./context.js";
import { print, type CommandResult } from "./output.js";

const HELP = `turbineh ${VERSION} — verified software capabilities for people and coding agents

  turbineh login <token>            save your invitation token
  turbineh init [--yes]             project preferences + instructions for Claude Code/Codex
  turbineh search "<need>"          capabilities and components that cover a need
  turbineh inspect <id>             what a capability includes, needs and was verified with
  turbineh plan "<need>"            plan for this project: components, files, deps, settings, cost
  turbineh apply [plan] [--approve] generate, then integrate on a new branch (one commit)
  turbineh verify [integration]     check the integration inside this project
  turbineh revert [integration]     undo one integration, keep later work
  turbineh status [plan]            flows, states and integrations
  turbineh left                     in a delivered package: what is left (open criteria, gate, settings)
  turbineh verify                   in a delivered package: typecheck, lint, unit tests → file:line and fix

  --json   structured output (same state and errors) for coding agents
  --yes    do not ask for confirmation (respects .turbineh/project.json policy)
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
      else if (["url", "stack", "limit", "resume"].includes(k) && next && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else args.push(a);
  }
  return { cmd: args.shift() ?? "help", args, flags };
}

const COMMANDS: Record<string, (c: Ctx) => Promise<CommandResult>> = {
  login,
  init,
  search,
  inspect,
  plan,
  apply,
  verify,
  revert,
  status,
  left,
};

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
  const fn = COMMANDS[cmd];
  if (!fn) {
    print(
      {
        ok: false,
        command: cmd,
        error: {
          code: "usage",
          message: `Unknown command "${cmd}".`,
          action: "Run `turbineh help`.",
        },
      },
      json,
    );
    return 2;
  }
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
  };
  try {
    const r = await fn(ctx);
    print(r, json);
    return r.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof CliError) {
      print({ ok: false, command: cmd, error: err.error }, json);
      return err.exitCode;
    }
    print(
      {
        ok: false,
        command: cmd,
        error: {
          code: "internal",
          message: err instanceof Error ? err.message : String(err),
          action: "Run the same command again; if it repeats, report it with `turbineh status`.",
        },
      },
      json,
    );
    return 1;
  }
}

if (!process.env.VITEST) process.exitCode = await main();

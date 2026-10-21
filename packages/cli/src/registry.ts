import { build, resume } from "./build.js";
import {
  aiToken,
  apply,
  init,
  inspect,
  left,
  login,
  notify,
  plan,
  revert,
  search,
  status,
  verify,
  type Ctx,
} from "./commands.js";
import { CliError } from "./context.js";
import { connect, disconnect } from "./github.js";
import type { CommandResult } from "./output.js";

export const COMMANDS: Record<string, (c: Ctx) => Promise<CommandResult>> = {
  login,
  init,
  search,
  inspect,
  plan,
  build,
  resume,
  apply,
  verify,
  revert,
  status,
  left,
  connect,
  disconnect,
  "ai-token": aiToken,
  notify,
};

/** Runs one command; failures become the same result object (and exit code) the CLI prints with --json. */
export async function runCommand(
  cmd: string,
  ctx: Ctx,
): Promise<{ result: CommandResult; exitCode: number }> {
  const fn = COMMANDS[cmd];
  if (!fn)
    return {
      result: {
        ok: false,
        command: cmd,
        error: {
          code: "usage",
          message: `Unknown command "${cmd}".`,
          action: "Run `turbineh help`.",
        },
        exitCode: 2,
      },
      exitCode: 2,
    };
  try {
    const r = await fn(ctx);
    const exitCode = r.exitCode ?? (r.ok ? 0 : 1);
    return { result: { ...r, exitCode }, exitCode };
  } catch (err) {
    if (err instanceof CliError)
      return {
        result: { ok: false, command: cmd, error: err.error, exitCode: err.exitCode },
        exitCode: err.exitCode,
      };
    return {
      result: {
        ok: false,
        command: cmd,
        error: {
          code: "internal",
          message: err instanceof Error ? err.message : String(err),
          action: "Run the same command again; if it repeats, report it with `turbineh status`.",
        },
        exitCode: 1,
      },
      exitCode: 1,
    };
  }
}

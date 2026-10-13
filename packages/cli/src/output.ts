import type { ProductError } from "@turbineh/shared";

/**
 * One result object per command. `--json` prints it as is (for Claude Code / Codex); the human view renders the same
 * state, data and errors. Both always include the next action.
 */
export interface CommandResult {
  ok: boolean;
  command: string;
  state?: string;
  data?: unknown;
  next?: string;
  error?: ProductError;
  /** Human rendering (ignored in --json). */
  lines?: string[];
  /** Process exit code when it is not simply 0 (ok) / 1 (not ok): see EXIT in build.ts. */
  exitCode?: number;
}

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");
export const cyan = paint("36");

export const STATE_LABEL: Record<string, string> = {
  planning: "preparing the plan",
  planned: "plan ready — nothing generated yet",
  generating: "generating and verifying",
  generated: "package generated, checks not all green",
  verified: "package generated and verified",
  integrated: "integrated in this project (not verified here yet)",
  integration_verified: "integrated and verified in this project",
  deployed: "deployed",
  failed: "failed",
};

/** The --json document of a result (also what the MCP server returns): everything but the human lines. */
export const jsonOf = (result: CommandResult) => ({ ...result, lines: undefined });

export function print(result: CommandResult, json: boolean, compact = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(jsonOf(result), null, compact ? 0 : 2)}\n`);
    return;
  }
  for (const l of result.lines ?? []) process.stdout.write(`${l}\n`);
  if (result.state)
    process.stdout.write(`\n${bold("State:")} ${STATE_LABEL[result.state] ?? result.state}\n`);
  if (result.error) {
    process.stderr.write(
      `\n${red("✖")} ${result.error.message}\n  ${bold("Do:")} ${result.error.action}\n`,
    );
    if (result.error.resume) process.stderr.write(`  ${bold("Resume:")} ${result.error.resume}\n`);
  }
  if (result.next) process.stdout.write(`\n${cyan("→")} ${result.next}\n`);
}

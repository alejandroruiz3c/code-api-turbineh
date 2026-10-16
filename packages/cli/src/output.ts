import { STATE_TEXT } from "@turbineh/shared";
import type { NotCoveredExplanation, ProductError } from "@turbineh/shared";

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

/** One source of state texts (ADR-0063): the CLI line of each state, from @turbineh/shared. */
export const STATE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_TEXT).map(([state, t]) => [state, t.line]),
);

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
    // ADR-0052/0062: an uncovered request lists what the library does not cover yet and why, the priority notice and
    // what TurbineH can do now (the components-only offer, when any).
    if (result.error.explanation)
      for (const l of explanationLines(result.error.explanation)) process.stderr.write(`  ${l}\n`);
    else
      for (const r of result.error.notCovered ?? [])
        process.stderr.write(`  ${yellow("✗")} ${r}\n`);
    if (result.error.resume) process.stderr.write(`  ${bold("Resume:")} ${result.error.resume}\n`);
  }
  if (result.next) process.stdout.write(`\n${cyan("→")} ${result.next}\n`);
}

/** An uncovered request in plain lines (ADR-0062): the same content as the web and the API. */
export function explanationLines(e: NotCoveredExplanation): string[] {
  const offer = e.offer;
  return [
    yellow(bold(e.title)) + (e.useCase ? `: ${e.useCase}` : ""),
    ...e.notCovered.map((r) => `${yellow("✗")} ${r.requirement} ${dim(`— ${r.why}`)}`),
    e.priority,
    `${bold("What we can do now:")} ${e.canDoNow}`,
    ...(offer
      ? [
          bold(offer.title),
          offer.youGet,
          yellow(offer.notIncluded),
          ...offer.components.flatMap((c) => [
            `${green("+")} ${c.id} ${dim(
              c.serves.length
                ? `— gives ${c.gives}, for: ${c.serves.join(" · ")}`
                : `— required by ${c.requiredBy ?? "another component"}`,
            )}`,
            ...c.proof.map((p) => `    ${dim(`proved by: ${p.test}`)}`),
          ]),
          ...offer.outOfScope.map((r) => `${dim("-")} ${dim(`out of scope: ${r.requirement}`)}`),
          `${bold("To build it:")} ${offer.approve.cli}`,
        ]
      : []),
  ];
}

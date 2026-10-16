import type { FlowState } from "./product.js";

/**
 * Single source of the status texts every surface shows (ADR-0063; external audit v2 N-06): the web, the HTTP API, the
 * CLI, the MCP server and turbineh.json read these, so a flow never reads "Checks 11/11 · Requirements 0/15 met" in
 * one place and "Build checks passed · 9 requirement(s) not met yet" in another.
 *
 * Two dimensions, never merged (F-01): the technical gate (build checks) and functional coverage (criteria of the
 * request a passing test proves / criteria derived from the request). "Verified" without a qualifier is shown only when
 * the gate passed and functional coverage reaches FUNCTIONAL_THRESHOLD.
 */
export const FUNCTIONAL_THRESHOLD = 0.8;

/** met / total, rounded to 3 decimals (0 when there is nothing to measure). */
export const functionalRatio = (met: number, total: number): number =>
  total <= 0 ? 0 : Math.round((Math.min(met, total) / total) * 1000) / 1000;

export interface VerdictInput {
  /** The technical gate passed (every build check green). */
  gateOk: boolean;
  /** Criteria a passing test proves. */
  met: number;
  /** Criteria derived from the request (after scope). 0 = nothing functional to measure (a component package). */
  total: number;
  /** Build checks passed / total, when known. */
  checks?: { passed: number; total: number; warnings?: number };
}

/**
 * The verdict line: "Verified · checks 11/11 · functional 9/10", "Technically verified · checks 11/11 · functional
 * 2/5" or "Not verified · checks 10/11 · functional 2/5". Without criteria: "Checks passed" / "Not verified".
 */
export function verdictLabel(v: VerdictInput): string {
  // "Pass with warnings" (ADR-0065) stays visible in the verdict line.
  const checks = v.checks
    ? ` · checks ${v.checks.passed}/${v.checks.total}${v.checks.warnings ? ` (${v.checks.warnings} with warnings)` : ""}`
    : "";
  if (v.total <= 0) return v.gateOk ? `Checks passed${checks}` : `Not verified${checks}`;
  const functional = ` · functional ${Math.min(v.met, v.total)}/${v.total}`;
  if (!v.gateOk) return `Not verified${checks}${functional}`;
  return functionalRatio(v.met, v.total) >= FUNCTIONAL_THRESHOLD
    ? `Verified${checks}${functional}`
    : `Technically verified${checks}${functional}`;
}

/** What the verdict means, in one sentence (tooltips, CLI, API `outcome.meaning` addenda). */
export function verdictMeaning(v: VerdictInput): string {
  if (v.total <= 0)
    return v.gateOk
      ? "Every build check passed in the TurbineH sandbox."
      : "Not every build check passed.";
  const open = v.total - Math.min(v.met, v.total);
  const functional =
    open === 0
      ? `every one of the ${v.total} requirement(s) is proven by a passing test`
      : `${v.met} of ${v.total} requirement(s) proven by a passing test; ${open} not met yet`;
  return v.gateOk
    ? `Build checks passed in the TurbineH sandbox; ${functional}.`
    : `Not every build check passed; ${functional}.`;
}

/** Flow states: the badge label, its tooltip and the CLI line. Nothing here says "verified" without a qualifier. */
export const STATE_TEXT: Record<FlowState, { label: string; hint: string; line: string }> = {
  planning: {
    label: "Planning",
    hint: "Reading the stack and choosing components",
    line: "preparing the plan",
  },
  planned: {
    label: "Planned",
    hint: "Plan built, not generated yet",
    line: "plan ready — nothing generated yet",
  },
  generating: {
    label: "Generating",
    hint: "Assembling and checking now",
    line: "generating and verifying",
  },
  generated: {
    label: "Delivered, not verified",
    hint: "Package produced; not every check passed — see what failed",
    line: "delivered, not verified — checks not all green (see the failure and fix)",
  },
  verified: {
    label: "Checks passed",
    hint: "Every build check passed in the TurbineH sandbox; requirements met are counted apart (functional coverage)",
    line: "build checks passed in the TurbineH sandbox (see functional coverage)",
  },
  integrated: {
    label: "Integrated",
    hint: "Applied in your project, checks pending",
    line: "integrated in this project (not verified here yet)",
  },
  integration_verified: {
    label: "Integrated · checks passed",
    hint: "Build checks also passed inside your project; requirements met are counted apart",
    line: "integrated; build checks passed in this project (see functional coverage)",
  },
  deployed: {
    label: "Deployed",
    hint: "Live in your own accounts",
    line: "deployed",
  },
  failed: {
    label: "Stopped",
    hint: "A check did not pass — see what to do",
    line: "failed",
  },
};

/** The steps of a flow as /use and the docs name them. Step 4 shows both dimensions, so it is not "Verified result". */
export const FLOW_STEPS: readonly [title: string, detail: string][] = [
  ["Describe", "New flow: the capability you need, in your words."],
  ["Plan", "Your environment, then one plan: components, files, settings, decisions."],
  ["Generate", "Live trace while the package is assembled, tested and scanned."],
  [
    "Checked result",
    "Build checks and functional coverage (requirements a passing test proves), shown apart, and the settings you provide.",
  ],
  ["Integrate", "Download the ZIP, or receive a pull request on your repository."],
];

/** Home and activity KPIs (N-04): checks and requirements, never "flows verified". */
export const KPI_TEXT = {
  checksPassed: "Checks passed (flows)",
  requirementsMet: "Requirements met (aggregate)",
} as const;

/**
 * Shortens a text to at most `max` characters at a word boundary, with an ellipsis ("…shortened to fit" never cuts a
 * word: "character-x"). Texts within the limit are returned unchanged.
 */
export function ellipsize(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(" ");
  const head = (space > max * 0.4 ? cut.slice(0, space) : cut).replace(/[\s,;:.·—-]+$/, "");
  return `${head}…`;
}

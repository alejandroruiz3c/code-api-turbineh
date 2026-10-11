import { choice, type Decider } from "@turbineh/decider";
import type { ImprovementEstimate, RemediationChange, SecurityAlert } from "@turbineh/remediation";
import OpenAI from "openai";
import { z } from "zod";

/** Verified facts the report is written from. Nothing outside these facts may appear in the report. */
export interface ReportFacts {
  appName: string;
  /** Plain-language label of each uncovered capability (shown to the user instead of ids). */
  gapLabels?: Record<string, string>;
  summary: string;
  recipe: string;
  entities: string[];
  acceptanceCriteria: string[];
  /** Evidence actually produced by the verification of this build (test names, checks). */
  evidence: string[];
  checks: { name: string; ok: boolean }[];
  components: { capability: string; id: string }[];
  gaps: string[];
  alerts: SecurityAlert[];
  remediation: RemediationChange[];
  reusedShare: number | null;
  /** Estimate for "Improve & redeliver" (null when it is not offered). */
  improvement?: ImprovementEstimate | null;
  /** True for the delivery produced by "Improve & redeliver": no further improvement is offered. */
  finalVersion?: boolean;
}

export interface BuildReport {
  headline: string;
  overview: string;
  criteria: { criterion: string; evidence: string; verified: boolean; confidence: number }[];
  security: {
    status: "clear" | "alerts";
    statusLine: string;
    points: string[];
    fixedBeforeDelivery: number;
  };
  nextSteps: string[];
  improvement: ImprovementEstimate | null;
  finalVersion: boolean;
  writer: { model: string; fallback: boolean };
}

export interface WriterConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}

const NOT_VERIFIED = "Not verified automatically";

const clip = (max: number) =>
  z
    .string()
    .min(3)
    .transform((v) => (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v));
const list = (max: number, len: number) =>
  z.array(z.string()).transform((v) =>
    v
      .filter((x) => x.trim().length >= 3)
      .slice(0, max)
      .map((x) => (x.length > len ? `${x.slice(0, len - 1).trimEnd()}…` : x)),
  );
const Summary = z.object({ headline: clip(120), overview: clip(700) });
const Security = z.object({ status_line: clip(200), points: list(6, 280) });
const Steps = z.object({ next_steps: list(5, 240) });

const SYSTEM =
  "You write one short section of a build report for a non-technical founder. Use ONLY the facts given. " +
  "Never invent numbers, features or guarantees. Never say the app is 'secure' or 'bug-free'. Plain English, " +
  "short sentences, no marketing. Keep the severity and scope of every alert exactly as given (for example " +
  "'high' and 'development-only'): never downplay or exaggerate a risk. Answer with JSON matching the requested shape.";

async function writePartOnce<T>(
  cfg: WriterConfig,
  schema: z.ZodType<T>,
  shape: string,
  task: string,
  facts: unknown,
): Promise<T> {
  const client = new OpenAI({
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    timeout: 60_000,
    maxRetries: 1,
  });
  const res = await client.chat.completions.create({
    model: cfg.model,
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `${task}\nShape: ${shape}\nFacts:\n${JSON.stringify(facts)}` },
    ],
    ...(cfg.reasoningEffort
      ? { reasoning_effort: cfg.reasoningEffort as OpenAI.ReasoningEffort }
      : {}),
  });
  return schema.parse(JSON.parse(res.choices[0]?.message.content ?? "{}"));
}

/** One retry: the writer is asked again before falling back to deterministic text. */
async function writePart<T>(
  cfg: WriterConfig,
  schema: z.ZodType<T>,
  shape: string,
  task: string,
  facts: unknown,
): Promise<T> {
  try {
    return await writePartOnce(cfg, schema, shape, task, facts);
  } catch {
    return writePartOnce(cfg, schema, shape, task, facts);
  }
}

/** Decider maps each acceptance criterion to the evidence that verified it (one atomic Choice per criterion). */
async function mapCriteria(facts: ReportFacts, decider: Decider): Promise<BuildReport["criteria"]> {
  if (facts.acceptanceCriteria.length === 0) return [];
  const options = Object.fromEntries([...facts.evidence, NOT_VERIFIED].map((e) => [e, null]));
  const questions = Object.fromEntries(
    facts.acceptanceCriteria.map((c, i) => [
      `c${i}`,
      choice(
        {
          criterion: c,
          question: "Which verification step demonstrates `criterion` for this app?",
        },
        options,
        { includeNone: false },
      ),
    ]),
  );
  const d = await decider.ask({ app: facts.summary, evidence: facts.evidence }, questions);
  return facts.acceptanceCriteria.map((criterion, i) => {
    const a = d.answers[`c${i}`];
    const evidence = a?.type === "choice" ? a.choice : NOT_VERIFIED;
    const confidence = a?.type === "choice" ? a.confidence : 0;
    // Low-confidence matches are reported honestly as not verified.
    const verified = evidence !== NOT_VERIFIED && confidence >= 0.5;
    return { criterion, evidence: verified ? evidence : NOT_VERIFIED, verified, confidence };
  });
}

function fallbackText(facts: ReportFacts): {
  headline: string;
  overview: string;
  statusLine: string;
  points: string[];
  nextSteps: string[];
} {
  const clear = facts.alerts.length === 0;
  return {
    headline: `${facts.appName} is built and verified`,
    overview: `${facts.summary} It includes ${facts.entities.join(", ") || "the requested screens"}, sign-in with workspaces and roles, and passed all ${facts.checks.length} automated checks.`,
    statusLine: clear
      ? "No open security alerts after verification."
      : `${facts.alerts.length} non-blocking security alert(s) remain.`,
    points: facts.alerts.slice(0, 6).map((a) => `${a.title}: ${a.explain}`),
    nextSteps: stepFacts(facts),
  };
}

/**
 * The closed list of next steps, built by code from verified facts (max 5). The writer may only rephrase them,
 * one by one; it cannot add steps.
 */
function stepFacts(facts: ReportFacts): string[] {
  const fixable = (facts.improvement?.fixable ?? 0) > 0;
  return [
    ...facts.gaps
      .slice(0, 2)
      .map(
        (g) =>
          `Not included in this version yet: ${facts.gapLabels?.[g] ?? g}. Add it yourself or ask for it in a new build.`,
      ),
    ...facts.alerts
      .slice(0, 2)
      .map(
        (a) =>
          `${a.title} (${a.level === "warning" ? "in what is shipped to users" : "development-only tool, not shipped to users"}): ${
            facts.finalVersion
              ? "it could not be fixed automatically; update it when a patched version is released."
              : fixable
                ? "it can be fixed with Improve & redeliver."
                : "no patched version exists yet; update it when one is released."
          }`,
      ),
    "Before deploying, set DATABASE_URL, BETTER_AUTH_SECRET and BETTER_AUTH_URL in your hosting environment.",
  ].slice(0, 5);
}

/** Builds the user-facing report: decider for criteria, open writer model for short texts, code for assembly. */
export async function buildReport(
  facts: ReportFacts,
  decider: Decider,
  writer: WriterConfig,
): Promise<BuildReport> {
  const fb = fallbackText(facts);
  const securityFacts = {
    checks: facts.checks,
    fixed_before_delivery: facts.remediation.map((r) => ({ what: r.target, why: r.detail })),
    remaining_alerts: facts.alerts.map((a) => ({
      affects: a.level === "warning" ? "what is shipped to users" : "development-only tools",
      title: a.title,
      explain: a.explain,
    })),
    automatic_improvement_possible: facts.improvement ? facts.improvement.fixable > 0 : false,
    always_included: [
      "security headers and content security policy",
      "input validation",
      "role-based access checks",
      "rate limiting",
      "safe error messages",
    ],
  };
  const [criteria, summary, security, steps] = await Promise.all([
    mapCriteria(facts, decider).catch(() =>
      facts.acceptanceCriteria.map((criterion) => ({
        criterion,
        evidence: NOT_VERIFIED,
        verified: false,
        confidence: 0,
      })),
    ),
    writePart(
      writer,
      Summary,
      '{"headline": string, "overview": string}',
      "Write a one-line headline and a 2–3 sentence overview of the app that was built.",
      {
        app: facts.appName,
        summary: facts.summary,
        entities: facts.entities,
        recipe: facts.recipe,
        reused_share: facts.reusedShare,
      },
    ).catch(() => null),
    writePart(
      writer,
      Security,
      '{"status_line": string, "points": string[]}',
      "Explain the security status: what protects the app, what was fixed automatically before delivery, and what alerts remain and why they matter or not.",
      securityFacts,
    ).catch(() => null),
    writePart(
      writer,
      Steps,
      '{"next_steps": string[]}',
      "Rewrite each fact as one clear next step for the founder: same order, exactly one step per fact, keep names, " +
        "versions and severities, add nothing else.",
      { facts: fb.nextSteps },
    )
      // A different number of steps means the writer added or dropped something: use the facts as written.
      .then((r) => (r.next_steps.length === fb.nextSteps.length ? r : null))
      .catch(() => null),
  ]);
  return {
    headline: summary?.headline ?? fb.headline,
    overview: summary?.overview ?? fb.overview,
    criteria,
    security: {
      status: facts.alerts.length === 0 ? "clear" : "alerts",
      statusLine: security?.status_line ?? fb.statusLine,
      points: security?.points ?? fb.points,
      fixedBeforeDelivery: facts.remediation.length,
    },
    nextSteps: steps?.next_steps ?? fb.nextSteps,
    improvement: facts.improvement ?? null,
    finalVersion: facts.finalVersion ?? false,
    writer: { model: writer.model, fallback: !summary || !security || !steps },
  };
}

/** Markdown version written into TURBINEH_REPORT.md. */
export function reportMarkdown(r: BuildReport, metricsJson: string): string {
  return `# ${r.headline}

${r.overview}

## Acceptance criteria

${r.criteria.map((c) => `- ${c.verified ? "✅" : "⬜"} ${c.criterion} — _${c.evidence}_`).join("\n") || "- (none)"}

## Security

**${r.security.statusLine}**${r.security.fixedBeforeDelivery ? ` (${r.security.fixedBeforeDelivery} issue(s) fixed automatically before delivery)` : ""}

${r.security.points.map((p) => `- ${p}`).join("\n")}

${improvementMarkdown(r)}See [SECURITY.md](SECURITY.md) for scope, tools and what was not checked.

## Next steps

${r.nextSteps.map((s) => `1. ${s}`).join("\n")}

---

<details><summary>Build metrics</summary>

\`\`\`json
${metricsJson}
\`\`\`

</details>

_Report written by ${r.writer.model}${r.writer.fallback ? " (some sections from deterministic templates)" : ""} from verified build facts only._
`;
}

/** Deterministic text about "Improve & redeliver" (numbers never come from the writer model). */
export function improvementText(
  r: Pick<BuildReport, "improvement" | "finalVersion">,
): string | null {
  if (r.finalVersion) {
    return "This is the improved, final version: the remaining alerts could not be fixed automatically and are explained above.";
  }
  const i = r.improvement;
  if (!i) return null;
  if (i.fixable === 0) {
    return "None of the remaining alerts can be fixed automatically, so no improvement is offered. They are explained above.";
  }
  return (
    `Improve & redeliver can most likely fix ${i.fixable} of ${i.total} remaining alert(s)` +
    `${i.fixableProduction ? ` (${i.fixableProduction} in what is shipped to users)` : " (all in development-only tools)"}. ` +
    `It takes about ${i.minutes.min}–${i.minutes.max} min, uses 1 build of your daily quota, re-runs every check and ` +
    "can be requested only once. Your current package stays available."
  );
}

function improvementMarkdown(r: BuildReport): string {
  const t = improvementText(r);
  return t ? `> ${t}\n\n` : "";
}

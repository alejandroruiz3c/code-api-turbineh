import type { ProductError } from "@turbineh/shared";
import { productError } from "./errors.js";
import {
  NOT_COVERED_ACTION,
  NOT_COVERED_TITLE,
  NOT_COVERED_WHY,
  parseNotCoveredReason,
} from "./scope-gate.js";

/**
 * Why a flow stopped, for people (ADR-0050): every raw reason the worker stores (`builds.error`) maps to what
 * happened, why, what to do and how to resume — the same text in the web, the API and the CLI. Deterministic; the
 * raw reason stays available to operators but is never the only thing a person sees.
 */
export interface FlowProblem extends ProductError {
  /** Short heading, e.g. "We could not understand the description". */
  title: string;
  /** Why it happened, in plain words. */
  why: string;
  /** The button the web shows for the next step. */
  next: { label: string; kind: "generate_again" | "new_flow" | "open_package" | "wait" };
}

interface Ctx {
  id: string;
  /** The row is an approved plan (generation can be requested again on the same flow). */
  fromPlan?: boolean;
}

const problem = (
  code: string,
  title: string,
  why: string,
  action: string,
  next: FlowProblem["next"],
  resume?: string,
): FlowProblem => ({ ...productError(code, `${title}. ${why}`, action, resume), title, why, next });

const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Only the shared contract fields (API `errors[]`, CLI `--json`). */
export const asProductError = (p: FlowProblem): ProductError => ({
  code: p.code,
  message: p.message,
  action: p.action,
  ...(p.resume ? { resume: p.resume } : {}),
  ...(p.notCovered ? { notCovered: p.notCovered } : {}),
});

/** The person-facing explanation of a failed flow. `raw` is the worker's reason (`builds.error`). */
export function explainFailure(raw: string | null | undefined, ctx: Ctx): FlowProblem {
  const r = (raw ?? "").trim();
  const resume = `turbineh status ${ctx.id}`;
  if (/^rejected by the Abuse Guard/i.test(r)) {
    const flags = /:\s*(.+)$/.exec(r)?.[1]?.replace(/\s*\([\d.]+\)/g, "") ?? "";
    return problem(
      "safety_blocked",
      "We cannot build this request",
      `Our safety check flagged it${flags ? ` (${flags})` : ""}. TurbineH never builds software for malware, phishing, spam or illegal content.`,
      "If this is a legitimate use, start a new flow and describe who uses the app and why in plain words.",
      { label: "Start a new flow", kind: "new_flow" },
    );
  }
  if (/BuildSpec invalid/i.test(r)) {
    return problem(
      "need_not_understood",
      "We could not turn the description into an app",
      "Two models tried to read the description as an app (screens, data, rules) and neither produced a valid result. Nothing was built.",
      "Start a new flow and describe it in a few sentences: who uses it, what they do, and what must be stored.",
      { label: "Start a new flow", kind: "new_flow" },
    );
  }
  const notCovered = parseNotCoveredReason(r);
  if (notCovered !== null || /out of scope/i.test(r)) {
    // ADR-0052: the library doesn't cover the use case; nothing was built and the demand was recorded.
    return {
      ...problem("use_case_not_covered", NOT_COVERED_TITLE, NOT_COVERED_WHY, NOT_COVERED_ACTION, {
        label: "Start a new flow",
        kind: "new_flow",
      }),
      notCovered: notCovered ?? [],
    };
  }
  if (/^Not delivered: a security or policy check blocks/i.test(r)) {
    return problem(
      "security_blocked",
      "The code was not delivered: a security check failed",
      `The generated app has a security or policy finding we do not ship (${short(r.replace(/^[^.]*\.\s*/, ""), 160) || "see SECURITY.md"}). You get the report, never code with a blocking finding.`,
      "Open the Check tab for the finding and SECURITY.md, then generate again (or start a new flow without the part that triggers it).",
      {
        label: ctx.fromPlan ? "Generate again" : "Start a new flow",
        kind: ctx.fromPlan ? "generate_again" : "new_flow",
      },
      resume,
    );
  }
  if (/^Delivered, not verified/i.test(r)) {
    return problem(
      "verification_failed",
      "Delivered, but one check did not pass",
      short(r, 400),
      'Download the package and fix the failing check first: AGENTS.md ("What is left") and turbineh.json give the exact test, file:line and the suggested fix; then re-run the checks.',
      { label: "Download the package", kind: "open_package" },
      resume,
    );
  }
  if (/worker lost the build|internal error|original build not available/i.test(r)) {
    return problem(
      "interrupted",
      "The build was interrupted on our side",
      "Our build server stopped while working on it (a restart or an internal error). It is not caused by your description.",
      ctx.fromPlan
        ? "Generate again: the plan is kept, so it starts where it left off."
        : "Start the flow again with the same description.",
      ctx.fromPlan
        ? { label: "Generate again", kind: "generate_again" }
        : { label: "Start the flow again", kind: "new_flow" },
      resume,
    );
  }
  if (/requires .* which is not an approved component/i.test(r)) {
    return problem(
      "component_unavailable",
      "A verified part this app needs is temporarily unavailable",
      "One component the template depends on is being re-verified in our catalog, so we did not build with an unverified version.",
      "Try again in a few minutes. If it keeps failing, start a new flow and mention the feature you need most.",
      ctx.fromPlan
        ? { label: "Generate again", kind: "generate_again" }
        : { label: "Start the flow again", kind: "new_flow" },
      resume,
    );
  }
  if (/time(d)? ?out|ETIMEDOUT|took longer/i.test(r)) {
    return problem(
      "timeout",
      "A step took too long and was stopped",
      "One step ran past its time limit. This is usually temporary (busy models or sandbox).",
      "Generate again; the parts already decided are reused, so the second run is faster.",
      ctx.fromPlan
        ? { label: "Generate again", kind: "generate_again" }
        : { label: "Start the flow again", kind: "new_flow" },
      resume,
    );
  }
  return problem(
    "generation_failed",
    "The app could not be generated",
    r ? `The last step reported: ${short(r)}` : "A step failed without a reason we could show.",
    ctx.fromPlan
      ? "Generate again. If it fails the same way, start a new flow with more detail about the part that failed."
      : "Start the flow again. If it fails the same way, add more detail about the part that failed.",
    ctx.fromPlan
      ? { label: "Generate again", kind: "generate_again" }
      : { label: "Start the flow again", kind: "new_flow" },
    ctx.fromPlan ? `turbineh apply --resume ${ctx.id}` : resume,
  );
}

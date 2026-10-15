import type { ProductError } from "@turbineh/shared";
import { NOT_COVERED_ACTION, NOT_COVERED_MESSAGE } from "./scope-gate.js";

/** Actionable errors: what happened, what to do and how to resume (never just "an error occurred"). */
export const productError = (
  code: string,
  message: string,
  action: string,
  resume?: string,
): ProductError => ({
  code,
  message,
  action,
  ...(resume ? { resume } : {}),
});

export const ERRORS = {
  unauthorized: () =>
    productError(
      "unauthorized",
      "No valid access token.",
      "Set TURBINEH_TOKEN (or run `turbineh login`) with the token from your invitation.",
    ),
  notFound: (what: string) =>
    productError(
      "not_found",
      `${what} not found in this workspace.`,
      "Check the id with `turbineh status`.",
    ),
  invalidRequest: (detail: string) =>
    productError("invalid_request", detail, "Fix the request and send it again."),
  planNotReady: (id: string) =>
    productError(
      "plan_not_ready",
      "The plan is still being prepared.",
      "Wait a few seconds and check again.",
      `turbineh status ${id}`,
    ),
  /**
   * ADR-0052 (supersedes ADR-0050 §4): a request whose use case the library does not cover is refused before anything
   * is generated, with the requirements that are not covered. The demand is recorded for a priority notification.
   */
  outOfScope: (notCovered: string[]): ProductError => ({
    ...productError("use_case_not_covered", NOT_COVERED_MESSAGE, NOT_COVERED_ACTION),
    notCovered,
  }),
  generationFailed: (id: string, reason: string) =>
    productError(
      "generation_failed",
      `The app could not be generated and verified: ${reason}`,
      "Generate again. If it fails the same way, start a new flow with more detail about the part that failed.",
      `turbineh apply --resume ${id}`,
    ),
  /** ADR-0037 §D1: the package is delivered, but the gate failed — never presented as verified. */
  verificationFailed: (id: string, reason: string) =>
    productError(
      "verification_failed",
      reason,
      'Download the package and fix the failing check first: AGENTS.md ("What is left") and turbineh.json give the exact test, file:line and the suggested fix; then re-run the gate.',
      `turbineh status ${id}`,
    ),
  missingEnv: (name: string, id: string) =>
    productError(
      "missing_env",
      `${name} is not set.`,
      `Set ${name} in your .env.local (see .env.example) — it is a credential only you have.`,
      `turbineh verify --resume ${id}`,
    ),
} as const;

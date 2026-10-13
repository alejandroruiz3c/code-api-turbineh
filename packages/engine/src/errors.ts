import type { ProductError } from "@turbineh/shared";

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
  outOfScope: (reason: string) =>
    productError(
      "no_capability",
      `No verified capability covers this need yet: ${reason}`,
      "Describe the need differently or search the catalog with `turbineh search`.",
    ),
  generationFailed: (id: string, reason: string) =>
    productError(
      "generation_failed",
      `The package could not be generated and verified: ${reason}`,
      "Review the failed checks in the result, then generate again.",
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
      `Set ${name} in your .env.local (see config/.env.example) — it is a credential only you have.`,
      `turbineh verify --resume ${id}`,
    ),
} as const;

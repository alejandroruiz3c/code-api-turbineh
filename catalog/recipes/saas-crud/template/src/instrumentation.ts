/**
 * Runs once when the server starts (Next.js instrumentation): the settings are validated here, so a missing or weak
 * setting (e.g. no email provider in production) stops `next start` with a clear message instead of failing on the
 * first request (ADR-0054).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./env");
}

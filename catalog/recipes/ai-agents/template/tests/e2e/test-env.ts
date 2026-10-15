/** Extra settings for the E2E run: one browser IP runs the whole suite against the public assistant. */
export const TEST_ENV: Record<string, string> = { AI_PUBLIC_REQUESTS_PER_MINUTE: "200" };

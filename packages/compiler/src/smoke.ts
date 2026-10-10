/**
 * WP4 smoke test: 5 prompts (one per beta recipe) must each produce a valid BuildSpec.
 *   pnpm smoke:compiler
 */
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { compileIntent } from "./index.js";

export const SMOKE_PROMPTS = [
  "A SaaS to manage gym memberships: organizations, admins and staff roles, members with plans and payment status, CRUD for members.",
  "A landing page for my coffee subscription startup with a waitlist form, confirmation email and an admin panel to see signups.",
  "An internal tool for our warehouse to track inventory items with filters, CSV import of stock and CSV export of low-stock reports.",
  "A booking app for a physiotherapy clinic: therapists set availability, patients book 45-minute slots, email notifications.",
  "A client portal for an accounting firm where clients upload documents and track the status of their tax filing requests.",
];

async function main() {
  loadLocalEnv();
  const env = readEnv();
  const config = {
    baseURL: env.COMPILER_BASE_URL,
    model: env.COMPILER_MODEL,
    ...(env.COMPILER_API_KEY ? { apiKey: env.COMPILER_API_KEY } : {}),
  };
  const results = [];
  for (const prompt of SMOKE_PROMPTS) {
    const r = await compileIntent(prompt, config);
    results.push({
      prompt: prompt.slice(0, 60) + "…",
      ok: r.ok,
      recipe: r.spec?.recipe,
      entities: r.spec?.entities.map((e) => e.name),
      capabilities: r.spec?.capabilities.length,
      attempts: r.attempts,
      latencyMs: r.latencyMs,
      usage: r.usage,
      errors: r.errors,
    });
  }
  const valid = results.filter((r) => r.ok).length;
  console.log(
    JSON.stringify({ model: config.model, valid: `${valid}/${results.length}`, results }, null, 2),
  );
  if (valid !== results.length) process.exitCode = 1;
}

await main();

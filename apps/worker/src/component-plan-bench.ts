/**
 * `pnpm --filter @turbineh/worker run bench:component-plan <label>` — precision of component-only plans (a capability
 * for an existing repository) on short single-capability needs, labelled by hand. Deterministic: no model is called.
 * Writes bench/results/<date>-component-plan-<label>.json.
 *
 * precision = selected components that the need requires (or the declared dependencies of those) / selected components.
 * recall = needs whose required component was selected / needs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DetectedStack } from "@turbineh/shared";
import { componentPlan } from "./product.js";

export interface ComponentPlanCase {
  need: string;
  /** At least one of these must be selected (the component the need asks for). */
  required: string[];
  /** Also relevant: alternatives for the same capability and declared dependencies. Anything else is unrelated. */
  relevant: string[];
}

/** Ten short single-capability needs (2026-10-13 incident: the first one selected a cart store, email…). */
export const COMPONENT_PLAN_CASES: ComponentPlanCase[] = [
  {
    need: "Small fetch-based HTTP client with retries and timeouts for external APIs",
    required: ["ops.http-client.ky"],
    relevant: ["ops.retry.p-retry"],
  },
  {
    need: "Fuzzy search over a small list of products",
    required: ["data.fuzzy-search.fuse", "data.search-index.minisearch"],
    relevant: [],
  },
  {
    need: "Send transactional emails to customers",
    required: ["email.transactional.turbineh", "email.transactional.resend"],
    relevant: [],
  },
  {
    need: "Limit how many async operations run at once",
    required: ["ops.concurrency.p-limit", "ops.queue-throttle.p-queue"],
    relevant: [],
  },
  {
    need: "Parse and format dates",
    required: ["data.dates.dayjs", "data.dates.date-fns"],
    relevant: ["data.timezones.date-fns-tz"],
  },
  {
    need: "Generate QR codes for event tickets",
    required: ["files.qr.qrcode", "files.qr.qrcode-react"],
    relevant: [],
  },
  {
    need: "Rate limiting for my API endpoints",
    required: ["ops.rate-limit.rate-limiter-flexible"],
    relevant: ["security.pack.turbineh"],
  },
  {
    need: "Detect the language of a text",
    required: ["ai.language-detection.franc-min"],
    relevant: [],
  },
  {
    need: "Parse and validate international phone numbers",
    required: ["data.phone.libphonenumber-js"],
    relevant: ["data.validation-strings.validator"],
  },
  {
    need: "Create PDF invoices",
    required: ["files.pdf.pdf-lib", "files.pdf.react-pdf"],
    relevant: [],
  },
];

/** The owner's stack in the incident: a connected Next.js repository (npm). */
export const REPO_STACK: DetectedStack = {
  language: "typescript",
  framework: "nextjs",
  packageManager: "npm",
  versions: { next: "15.5.26" },
  source: "repo",
  adaptationPending: false,
};

export interface ComponentPlanScore {
  need: string;
  selected: string[];
  unrelated: string[];
  hit: boolean;
}

export function scoreComponentPlans(componentsDir: string, cases = COMPONENT_PLAN_CASES) {
  const rows: ComponentPlanScore[] = cases.map((c) => {
    const plan = componentPlan("bench", { need: c.need, stack: REPO_STACK }, componentsDir);
    const selected = plan.components.map((x) => x.id);
    const ok = new Set([...c.required, ...c.relevant]);
    return {
      need: c.need,
      selected,
      unrelated: selected.filter((id) => !ok.has(id)),
      hit: selected.some((id) => c.required.includes(id)),
    };
  });
  const total = rows.reduce((a, r) => a + r.selected.length, 0);
  const wrong = rows.reduce((a, r) => a + r.unrelated.length, 0);
  return {
    rows,
    precision: total === 0 ? 0 : (total - wrong) / total,
    recall: rows.filter((r) => r.hit).length / rows.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const label = process.argv[2] ?? "run";
  const result = scoreComponentPlans(join(root, "catalog/components"));
  for (const r of result.rows)
    console.log(
      `${r.hit ? "✓" : "✗"} ${r.need}\n    ${r.selected.join(", ")}${r.unrelated.length ? `\n    unrelated: ${r.unrelated.join(", ")}` : ""}`,
    );
  console.log(
    `precision ${(result.precision * 100).toFixed(1)} % · recall ${(result.recall * 100).toFixed(0)} %`,
  );
  const out = join(
    root,
    "bench/results",
    `${new Date().toISOString().slice(0, 10)}-component-plan-${label}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ label, ...result }, null, 2)}\n`);
  console.log(`→ ${out}`);
}

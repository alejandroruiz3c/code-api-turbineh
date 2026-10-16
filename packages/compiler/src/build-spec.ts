import { z } from "zod";
import { paletteSchema } from "./palette.js";

/** Beta recipes (PLAN §3.8). Anything else is answered honestly as out of scope. */
export const RECIPES = [
  "saas-crud",
  "landing-waitlist",
  "internal-tool",
  "bookings",
  "client-portal",
  "corporate-site",
  "storefront",
  "projects",
  "analytics-dashboard",
  "tracker",
  "ai-agents",
] as const;

/**
 * Capability ids the Selector can resolve (category.capability). AI in client apps (F3, ADR-0028) goes only through
 * the orchestrator (`ai.orchestrator`) with its AI Safety Pack (`security.ai-safety`), required by recipe ai-agents.
 */
export const CAPABILITIES = [
  "auth.session",
  "auth.oauth",
  "authz.roles",
  "authz.organizations",
  "data.orm",
  "data.validation",
  "data.pagination",
  "data.csv-import",
  "data.csv-export",
  "ui.table",
  "ui.form",
  "ui.layout",
  "ui.calendar",
  "ui.charts",
  "files.upload",
  "email.transactional",
  "payments.checkout",
  "jobs.queue",
  "jobs.scheduler",
  "observability.logging",
  "ops.rate-limit",
  "ops.idempotency",
  "security.headers",
  "data.dates",
  "data.timezones",
  "data.recurrence",
  "data.ics-export",
  "data.ids",
  "data.slug",
  "data.money",
  "data.phone",
  "data.fuzzy-search",
  "data.xlsx-export",
  "data.serialization",
  "ui.markdown",
  "security.sanitize-html",
  "security.jwt",
  "security.password-hash",
  "security.webhook-signature",
  "auth.mfa",
  "ops.retry",
  "ops.concurrency",
  "files.pdf",
  "files.qr",
  "files.type-detection",
  "ui.date-picker",
  "ui.icons",
  "ui.notifications",
  "ui.styling",
  "ui.command-palette",
  "ui.dialog",
  "ui.i18n",
  "data.diff",
  "security.html-escape",
  "content.blog",
  "content.rss",
  "seo.structured-data",
  "seo.sitemap",
  "ui.carousel",
  "ui.accordion",
  "ui.tabs",
  "ui.menu",
  "ui.tooltip",
  "ui.popover",
  "ui.select",
  "ui.navigation",
  "ui.animation",
  "ui.drag-drop",
  "ui.virtual-list",
  "ui.otp-input",
  "ui.drawer",
  "ui.url-state",
  "commerce.cart",
  "data.countries",
  "storage.objects",
  "data.search-index",
  "data.fetching",
  "files.barcode",
  "data.xml",
  "ops.http-client",
  "email.plain-text",
  "ui.map",
  "files.image-processing",
  "privacy.cookie-consent",
  "ui.lightbox",
  "ui.slider",
  "ui.checkbox",
  "ui.switch",
  "ui.progress",
  "ui.avatar",
  "ui.scroll-area",
  "ui.toggle-group",
  "ui.alert-dialog",
  "ui.hover-card",
  "ui.color-picker",
  "payments.subscriptions",
  // F3 (ADR-0028): the orchestrator #001 and its AI Safety Pack, required by recipe ai-agents
  "ai.orchestrator",
  "security.ai-safety",
  // F3: utilities for AI agents and inference processes (no direct model calls; models go through #001)
  "ai.token-count",
  "files.pdf-text",
  "files.docx-text",
  "files.office-text",
  "content.html-to-markdown",
  "content.readability",
  "content.html-dom",
  "content.html-parse",
  "ai.json-repair",
  "ai.partial-json",
  "ai.sse-parsing",
  "ai.schema-validation",
  "ai.vector-store",
  "ai.language-detection",
  "ai.prompt-templates",
  "ops.queue-throttle",
  "ai.mcp-server",
  "ai.text-chunking",
  "ai.stopwords",
  "content.markdown-to-text",
  "data.yaml",
  "email.parsing",
  // Social networks (ADR-0067): OAuth connections, publishing and engagement metrics (LinkedIn, Meta Graph, X)
  "social.oauth",
  "social.publish",
  "social.metrics",
] as const;

const item = (t: number, x: number) =>
  z.object({ title: z.string().min(2).max(t), text: z.string().min(5).max(x) });

type FaqItem = { q: string; a: string };
const isQuestion = (s: string) => /\?\s*$/.test(s);

/**
 * FAQ items with question and answer in the right place (deterministic). Small models sometimes invert them (Frontiers
 * shop: every answer was in `q`): an item whose answer is a question and whose question is not gets swapped back.
 */
export function normalizeFaq<T extends FaqItem>(faq: readonly T[]): T[] {
  return faq.map((f) => (!isQuestion(f.q) && isQuestion(f.a) ? { ...f, q: f.a, a: f.q } : f));
}

/** Public-site copy (landing, corporate site, storefront). Rendered as plain text by the recipes. */
export const sitePart = z.object({
  tagline: z.string().min(5).max(90),
  hero_subtitle: z.string().min(10).max(220),
  features: z.array(item(48, 180)).min(3).max(6),
  steps: z.array(item(48, 180)).min(3).max(4),
  services: z.array(item(48, 200)).min(3).max(6),
  about: z.string().min(20).max(600),
  faq: z
    .array(z.object({ q: z.string().min(5).max(140), a: z.string().min(5).max(400) }))
    .min(3)
    .max(6),
  cta: z.string().min(3).max(40),
});

const fieldType = z.enum([
  "string",
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "email",
  "enum",
  "file",
  "reference",
  // Added by code, never proposed by the model (ADR-0042): a multi-value tag field with a filter.
  "tags",
]);

export const buildSpecSchema = z
  .object({
    recipe: z.enum([...RECIPES, "out_of_scope"]),
    out_of_scope_reason: z.string().nullable(),
    closest_recipe: z.enum(RECIPES).nullable(),
    app_name: z.string().min(2).max(60),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(40),
    summary: z.string().min(10).max(400),
    roles: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .min(1)
      .max(6),
    entities: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
          fields: z
            .array(
              z.object({
                name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
                type: fieldType,
                required: z.boolean(),
                // Allowed values of an enum field, from a list the request states (ADR-0042; set by code).
                options: z.array(z.string().min(1).max(40)).min(2).max(30).optional(),
              }),
            )
            .min(1)
            .max(25),
        }),
      )
      .max(12),
    pages: z
      .array(
        z.object({
          // Dynamic segments as ":param". Kept escape-free so every provider's grammar engine accepts it.
          path: z.string().regex(new RegExp("^/[a-z0-9/:_-]*$")),
          purpose: z.string().min(3).max(160),
          auth_required: z.boolean(),
        }),
      )
      .min(1)
      .max(20),
    // Decided by the decider (one Noul per capability), bounded by the enum; duplicates removed in code.
    capabilities: z
      .array(z.enum(CAPABILITIES))
      .min(1)
      .max(CAPABILITIES.length)
      .transform((caps) => [...new Set(caps)]),
    // The model writes 3–15 (parts.ts); canonical wording (ADR-0063) may split a criterion that states two functions.
    acceptance_criteria: z.array(z.string().min(8).max(200)).min(3).max(24),
    // Canonical criterion → the request's own criteria it replaced (ADR-0063), set by code when the plan is made.
    criteria_asked: z.record(z.string(), z.array(z.string())).optional(),
    // The request's subject words (its own nouns, capability and platform words left out), set by code (ADR-0063).
    request_words: z.array(z.string()).optional(),
    // Public-site copy (optional part; recipes fall back to deterministic copy when it is null).
    site: sitePart.nullable().optional(),
    // Visual identity stated in the prompt (explicit colours and type), extracted by code; applied as theme tokens.
    palette: paletteSchema.nullable().optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.recipe === "out_of_scope" && !spec.out_of_scope_reason) {
      ctx.addIssue({
        code: "custom",
        path: ["out_of_scope_reason"],
        message: "required when recipe is out_of_scope",
      });
    }
    const names = spec.entities.map((e) => e.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["entities"], message: "entity names must be unique" });
    }
  });

export type BuildSpec = z.infer<typeof buildSpecSchema>;

import { z } from "zod";

/** Beta recipes (PLAN §3.8). Anything else is answered honestly as out of scope. */
export const RECIPES = [
  "saas-crud",
  "landing-waitlist",
  "internal-tool",
  "bookings",
  "client-portal",
  "corporate-site",
  "storefront",
] as const;

/** Capability ids the Selector can resolve (category.capability). `ai.*` is blocked until Phase 3. */
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
] as const;

const item = (t: number, x: number) =>
  z.object({ title: z.string().min(2).max(t), text: z.string().min(5).max(x) });

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
    acceptance_criteria: z.array(z.string().min(8).max(200)).min(3).max(15),
    // Public-site copy (optional part; recipes fall back to deterministic copy when it is null).
    site: sitePart.nullable().optional(),
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

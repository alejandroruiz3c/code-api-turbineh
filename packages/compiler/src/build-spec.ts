import { z } from "zod";

/** Beta recipes (PLAN §3.8). Anything else is answered honestly as out of scope. */
export const RECIPES = [
  "saas-crud",
  "landing-waitlist",
  "internal-tool",
  "bookings",
  "client-portal",
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
] as const;

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
          path: z.string().regex(/^\/[a-z0-9\-/[\]]*$/),
          purpose: z.string().min(3).max(160),
          auth_required: z.boolean(),
        }),
      )
      .min(1)
      .max(20),
    capabilities: z.array(z.enum(CAPABILITIES)).min(1),
    acceptance_criteria: z.array(z.string().min(8).max(200)).min(3).max(15),
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

/** JSON Schema handed to the model for constrained decoding (refinements are re-checked in code). */
export const buildSpecJsonSchema = z.toJSONSchema(buildSpecSchema, {
  target: "draft-7",
  io: "input",
});

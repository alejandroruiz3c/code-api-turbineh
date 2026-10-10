import { z } from "zod";
import type { CAPABILITIES, RECIPES } from "./build-spec.js";

/**
 * The BuildSpec is produced in small, simple pieces (owner principle: decomposed content and simple tasks degrade
 * less than one complex task). Classification goes to the decider as atomic questions in ONE batched request;
 * the small model only writes four small structured parts, in parallel.
 */

export const RECIPE_DESCRIPTIONS: Record<(typeof RECIPES)[number] | "out_of_scope", string> = {
  "saas-crud":
    "Multi-user SaaS with sign-in, organizations or teams, roles and CRUD screens over business data",
  "landing-waitlist":
    "Marketing landing page with a signup or waitlist form, confirmation email and a small admin view",
  "internal-tool": "Internal back-office tool with data tables, filters, CSV import and export",
  bookings: "Booking or appointment app with availability, calendar slots and notifications",
  "client-portal":
    "Portal where external clients upload files and follow the status of their requests",
  out_of_scope:
    "Anything else: not a web app, mobile/desktop/game, AI features in the app, scraping, or a different product family",
};

/** One atomic yes/no question per optional capability. Always-on capabilities are added in code. */
export const ALWAYS_ON: readonly (typeof CAPABILITIES)[number][] = [
  "security.headers",
  "data.validation",
];

export const CAPABILITY_QUESTIONS: Partial<Record<(typeof CAPABILITIES)[number], string>> = {
  "auth.session": "Users must sign in to use part of the app.",
  "auth.oauth": "The prompt asks for sign-in with an external provider such as Google or GitHub.",
  "authz.roles": "Different users have different roles or permission levels.",
  "authz.organizations":
    "Users belong to organizations, teams or workspaces that separate their data.",
  "data.orm": "The app stores records in a database.",
  "data.pagination": "The app lists many records that need pages.",
  "data.csv-import": "Users import data from CSV or spreadsheet files.",
  "data.csv-export": "Users export data to CSV or spreadsheet files.",
  "ui.table": "The app shows records in a table with columns.",
  "ui.form": "Users fill in forms to create or edit data.",
  "ui.layout": "The app has a dashboard or several pages with shared navigation.",
  "ui.calendar": "The app shows a calendar, schedule or time slots.",
  "ui.charts": "The app shows charts or graphs.",
  "files.upload": "Users upload files or documents.",
  "email.transactional": "The app sends emails or notifications to users.",
  "payments.checkout": "Users pay online or subscribe to a paid plan.",
  "jobs.queue": "Work runs in the background after the user's request.",
  "jobs.scheduler": "Something must happen automatically at scheduled times, such as reminders.",
  "observability.logging": "The prompt asks for logs, audit trails or activity history.",
  "ops.rate-limit": "Public endpoints or forms need protection against abuse or spam.",
  "ops.idempotency": "The prompt involves payments or actions that must not run twice.",
};

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

export const metaPart = z.object({
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
});

export const entitiesPart = z.object({
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
          .max(15),
      }),
    )
    .max(8),
});

export const pagesPart = z.object({
  pages: z
    .array(
      z.object({
        path: z.string().regex(new RegExp("^/[a-z0-9/:_-]*$")),
        purpose: z.string().min(3).max(160),
        auth_required: z.boolean(),
      }),
    )
    .min(1)
    .max(12),
});

export const criteriaPart = z.object({
  acceptance_criteria: z.array(z.string().min(8).max(200)).min(3).max(10),
});

export const PARTS = {
  meta: {
    schema: metaPart,
    instruction:
      "Name the app, give a URL slug (lowercase, hyphens), a one-sentence summary and the user roles (snake_case).",
  },
  entities: {
    schema: entitiesPart,
    instruction:
      "List the data entities (PascalCase) and their fields (camelCase). Only what the prompt needs. No user/auth tables: auth is provided.",
  },
  pages: {
    schema: pagesPart,
    instruction:
      "List the pages with their URL path (lowercase, dynamic segments as :id), purpose, and whether sign-in is required.",
  },
  criteria: {
    schema: criteriaPart,
    instruction: "Write 3 to 10 concrete, testable acceptance criteria, one behaviour each.",
  },
} as const;

export type PartName = keyof typeof PARTS;

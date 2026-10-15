import { z } from "zod";
import type { CAPABILITIES, RECIPES } from "./build-spec.js";
import { normalizeFaq, sitePart } from "./build-spec.js";
import { NON_FUNCTIONAL_INSTRUCTION } from "./non-functional.js";

/**
 * The BuildSpec is produced in small, simple pieces (owner principle: decomposed content and simple tasks degrade
 * less than one complex task). Classification goes to the resource decision engine; the small model only writes four
 * small structured parts, in parallel.
 */

export const RECIPE_DESCRIPTIONS: Record<(typeof RECIPES)[number] | "out_of_scope", string> = {
  "saas-crud":
    "Multi-user SaaS with sign-in, organizations or teams, roles and CRUD screens over business data",
  "landing-waitlist":
    "Marketing landing page with a signup or waitlist form, confirmation email and a small admin view",
  "internal-tool": "Internal back-office tool with data tables, filters, CSV import and export",
  bookings:
    "Booking or appointment app operated through screens: availability, calendar slots and notifications (no AI assistant; an AI agent that books for users is ai-agents)",
  "client-portal":
    "Portal where external clients upload files and follow the status of their requests",
  "corporate-site":
    "Company or professional website: home, services, about, blog or news, contact form, edited by the team",
  storefront:
    "Online shop: product catalog with prices and images, product options (sizes, colours) with own stock, cart, discount codes, prices in several currencies, shipping options and taxes by country (or automatic tax by the payment provider), online payment, orders and stock managed by the owner",
  projects:
    "Project and task management for a team: projects, kanban boards, tasks with assignees, priorities, due dates and comments",
  "analytics-dashboard":
    "Dashboard to analyse business data: import or enter figures, KPIs, charts over time and by category, filters and export",
  tracker:
    "Personal tracker app: habits, health, fitness, money or any daily quantity with goals, streaks and history",
  "ai-agents":
    "AI assistants and AI processing for a team: assistants or agents with instructions and allowed tools, chat over a knowledge base of the team's documents, batch AI processing of records (classify, extract, summarise), AI usage and audit; also AI agents specialised in a domain (bookings and appointments, support, sales, intake) that talk with users in natural language and act with tools over the app's records; every AI call goes through the TurbineH orchestrator",
  out_of_scope:
    "Anything else: not a web app, mobile/desktop/game, training or hosting AI models, autonomous agents acting without human confirmation on payments or external accounts, scraping, or a different product family",
};

/** Capabilities every build includes (added in code; optional ones come from the decision engine). */
export const ALWAYS_ON: readonly (typeof CAPABILITIES)[number][] = [
  "security.headers",
  "data.validation",
];

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
  acceptance_criteria: z.array(z.string().min(8).max(200)).min(3).max(15),
});

/**
 * What the model writes for the site part: explicit `question` / `answer` keys (the terse `q` / `a` keys were inverted
 * by the model in the Frontiers shop run), mapped to the BuildSpec shape and normalised in code.
 */
export const siteModelPart = sitePart
  .extend({
    faq: z
      .array(
        z.object({
          question: z.string().min(5).max(140),
          answer: z.string().min(5).max(400),
        }),
      )
      .min(3)
      .max(6),
  })
  .transform((site) => ({
    ...site,
    faq: normalizeFaq(site.faq.map((f) => ({ q: f.question, a: f.answer }))),
  }));

export const PARTS = {
  meta: {
    schema: metaPart,
    instruction:
      "Name the app, give a URL slug (lowercase, hyphens), a one-sentence summary and the user roles (snake_case).",
  },
  entities: {
    schema: entitiesPart,
    instruction: `List the data entities (PascalCase) and their fields (camelCase). Only what the prompt needs. No user/auth tables: auth is provided. ${NON_FUNCTIONAL_INSTRUCTION}`,
  },
  pages: {
    schema: pagesPart,
    instruction:
      "List the pages with their URL path (lowercase, dynamic segments as :id), purpose, and whether sign-in is required.",
  },
  criteria: {
    schema: criteriaPart,
    instruction:
      "Write 3 to 15 concrete, testable acceptance criteria, one behaviour each: one per behaviour the request states (a long specification gets more), none it does not state.",
  },
  site: {
    schema: siteModelPart,
    instruction:
      "Write the public website copy for this business in plain, specific English: a tagline, a hero subtitle, 3-6 " +
      "benefits, 3-4 'how it works' steps, 3-6 services, a short 'about us', 3-6 FAQs (`question` ends with '?', `answer` answers it) and a call to " +
      "action. No prices, phone numbers, addresses or claims you cannot know from the prompt.",
  },
} as const;

/** Recipes with a public website that renders the `site` copy. */
export const PUBLIC_SITE_RECIPES = ["landing-waitlist", "corporate-site", "storefront"] as const;

/** Parts whose failure does not fail the build (deterministic fallback in the recipes). */
export const OPTIONAL_PARTS: readonly PartName[] = ["site"];

export type PartName = keyof typeof PARTS;

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
  "data.dates": "The app calculates or formats dates (due dates, durations, schedules).",
  "data.timezones": "The app shows times to users in different time zones.",
  "data.recurrence": "The app has recurring events such as weekly sessions.",
  "data.ics-export": "Users add events to their own calendar (Google, Outlook, Apple).",
  "data.ids": "The app needs public, unguessable identifiers or codes.",
  "data.slug": "Records have human-readable URLs built from their titles.",
  "data.money": "The app stores or calculates money amounts or prices.",
  "data.phone": "Users enter phone numbers that must be valid.",
  "data.fuzzy-search": "Users search with typos or partial words in small lists.",
  "data.xlsx-export": "Users export data to Excel files.",
  "data.serialization": "Rich data such as dates is sent between server and browser.",
  "ui.markdown": "Users write formatted text such as notes or descriptions with Markdown.",
  "security.sanitize-html": "Users submit rich text or HTML that is shown to others.",
  "security.jwt": "The app issues or verifies signed tokens for APIs or links.",
  "security.password-hash": "The app stores passwords or secrets that must be hashed.",
  "security.webhook-signature": "The app sends or receives webhooks that must be signed.",
  "auth.mfa": "Users can enable two-factor authentication.",
  "ops.retry": "Calls to external services must be retried when they fail.",
  "ops.concurrency": "The app processes many items and must limit parallel work.",
  "files.pdf": "The app generates PDF documents such as invoices or reports.",
  "files.qr": "The app shows QR codes.",
  "files.type-detection": "Uploaded files must be checked for their real type.",
  "ui.date-picker": "Users pick dates in forms.",
  "ui.icons": "The interface uses icons.",
  "ui.notifications": "Users see short confirmation or error messages after actions.",
  "ui.styling": "The interface has reusable styled component variants.",
  "ui.command-palette": "Power users navigate with a keyboard command menu.",
  "ui.dialog": "The interface uses modal dialogs for confirmations or forms.",
  "ui.i18n": "The app is available in more than one language.",
  "data.diff": "Users compare versions of text or see change history.",
  "security.html-escape": "User text is inserted into HTML emails or documents.",
  "content.blog": "The site has a blog, news or articles section.",
  "content.rss": "Readers can subscribe to the blog or news with RSS.",
  "seo.structured-data":
    "Search engines should show rich results (organization, products, articles).",
  "seo.sitemap": "The public site must be indexed well by search engines (sitemap).",
  "ui.carousel": "The interface shows a carousel or slider (testimonials, galleries, products).",
  "ui.accordion": "The page has collapsible sections such as a FAQ.",
  "ui.tabs": "Content is organised in tabs.",
  "ui.menu": "The interface has dropdown or context menus.",
  "ui.tooltip": "Controls need tooltips that explain them.",
  "ui.popover": "Small panels open next to a control (filters, quick actions).",
  "ui.select": "Forms use rich select boxes.",
  "ui.navigation": "A public website needs a navigation menu with submenus.",
  "ui.animation": "The interface should feel animated (transitions, reveal on scroll).",
  "ui.drag-drop": "Users drag and drop items (kanban boards, reordering, sorting).",
  "ui.virtual-list": "Lists or tables can have thousands of rows.",
  "ui.otp-input": "Users type one-time codes (two-factor, email verification).",
  "ui.drawer": "Panels slide in from the side or bottom (cart, filters on mobile).",
  "ui.url-state": "Filters, search or tabs are kept in the URL so they can be shared.",
  "commerce.cart": "Shoppers add products to a cart before paying.",
  "data.countries": "Users pick countries (addresses, shipping, phone prefixes).",
  "storage.objects": "The app stores many or large files and images (product photos, media).",
  "data.search-index": "Users search a catalog or documentation by text.",
  "data.fetching": "The browser loads and refreshes data from the server while the page is open.",
  "files.barcode": "The app prints or shows barcodes (products, tickets, labels).",
  "data.xml": "The app imports or exports XML (product feeds, sitemaps, integrations).",
  "ops.http-client": "The app calls external APIs.",
  "email.plain-text": "Emails need a plain-text version for better deliverability.",
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

/**
 * Abuse Guard (PLAN §2, §5.4): atomic yes/no questions asked in the SAME decider batch as the recipe and
 * capabilities. Any answer at or above the threshold rejects the build before anything is assembled.
 */
export const ABUSE_QUESTIONS: Record<string, string> = {
  malware:
    "The request asks for malware, credential stealers, ransomware or tools to break into systems.",
  phishing:
    "The request asks for a page that imitates a real bank, brand or login page to collect credentials.",
  spam: "The request asks for mass unsolicited messaging, fake reviews or scraping of personal data.",
  illegal: "The request asks for something illegal, such as selling weapons, drugs or stolen data.",
  sexual_minors: "The request involves sexual content with minors.",
};
export const ABUSE_THRESHOLD = 0.5;

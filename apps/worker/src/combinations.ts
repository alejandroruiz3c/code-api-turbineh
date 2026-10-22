/**
 * Recipe + component combinations, assembled exactly as the pipeline assembles them (ADR-0037 §D4). A change to one
 * catalog component can break another one only when both are assembled together (66af3182: a bookings-domain E2E
 * test broke against the ai-agents recipe's staff default). `verify:recipe` and CI check every combination, so such a
 * regression is caught before main, not in a client build.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assemble, mergedRecipe, recipeChain, type SelectedComponent } from "@turbineh/assembler";
import { readParamsDecl, validateParams } from "@turbineh/catalog";
import { ALWAYS_ON, detectDomains, extractPalette, type BuildSpec } from "@turbineh/compiler";
import type { CandidateCard } from "@turbineh/selector";
import { loadCatalog } from "./catalog-source.js";

/**
 * One representative request per domain component: the request that makes the compiler select it. A new domain
 * component adds its probe here (checked by `combinations.test.ts`).
 */
export const DOMAIN_PROBES: Record<string, string> = {
  "domain.bookings.turbineh":
    'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
    "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check " +
    "availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours " +
    "before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring). The assistant " +
    "must use tools over the clinic's real data (availability, create/move/cancel booking, find booking by email) and " +
    "never invent a slot; it confirms details before booking and sends a confirmation email. Staff sign in to see and " +
    "manage the bookings. The assistant's language model is reached through an OpenAI-compatible endpoint configured by " +
    "environment variables; tests must use a local mock of that endpoint (no internet in tests). Protect it against " +
    "prompt injection and abuse (input limits, rate limits).",
  "payments.booking-deposit.turbineh":
    'Build an online booking site for "Studio Lumen", a hair salon with two stylists. Services: cut 30 min (25 €), ' +
    "colour 90 min (70 €). Opening hours Monday–Saturday 10:00–19:00, Europe/Madrid. Customers pick a service, a " +
    "stylist (or any) and a free time, and pay a 10 € deposit by card to confirm the booking; a booking that is not " +
    "paid in time is released. They receive a confirmation email with a cancel link. Staff sign in to see the calendar.",
  "ai.mail-triage.turbineh":
    "Build an AI assistant for my personal mailbox: it reads the emails I receive, classifies each one and orders " +
    "them by priority, and every morning at 7am sends me a daily summary of the important emails I must answer. When " +
    "an email is an invoice or a payment, it records the amount in a spreadsheet of my personal finances (income, " +
    "expenses and investments) that I can download as Excel. Times in Europe/Madrid.",
  // ADR-0072: recommendations over the client's verified catalogue, with viewings through the booking domain.
  "ai.recommendations.turbineh":
    'Build "Casa Brisa Finder", an AI assistant for a developer of new-build homes on the coast near Valencia, prices ' +
    "in euros. Buyers chat in plain language: the assistant asks for their budget, the town they prefer and how many " +
    "bedrooms they need, recommends matching homes from our verified listings only, answers questions about a home, " +
    "compares homes side by side and books a 30-minute viewing with one of our 2 advisers (Lucía, Pau), " +
    "Monday–Saturday 10:00–19:00, Europe/Madrid. Staff sign in to manage the listings and see the viewings.",
};

/** The social publishing request of the social.* combination (ADR-0067). */
export const SOCIAL_PUBLISHER_PROMPT =
  'Build "Crumb & Co Social", a social media publisher for a small bakery: the owner connects LinkedIn, Instagram, ' +
  "Facebook and X accounts; team members write posts, adapted to each network's format and length, and the owner " +
  "approves each post before it is published; posts are scheduled and published at the chosen time, retried on " +
  "failure, and every publication is logged; a content calendar and a dashboard with likes, comments and shares of " +
  "published posts.";

/** Synthetic requests of the use cases added from real demand (ADR-0073), paraphrased — never customers' words. */
export const BLOG_PROMPT =
  'Build "Field Notes", a calm landing page with a waitlist and a blog where our team publishes long-form articles ' +
  "about robotics research: authors with a short bio, tags, a reading time on each post, drafts until published, " +
  "an RSS feed and good SEO.";
export const RECORDER_PROMPT =
  'Build "Clipcast", a tool like Loom: record the screen and the webcam in 4K when the camera allows it, choose a ' +
  "layout (camera bubble in a corner, side by side, screen only, camera only), save each video privately to a " +
  "library and share it with a link.";
export const MATCHING_PROMPT =
  'Build "Bidscope", a multi-tenant B2B platform that monitors public tenders. Each organization signs up, invites ' +
  "teammates as admin, editor or viewer, and configures its profile: business activities, sectors, regions and " +
  "keywords of interest. A user may belong to several organizations and switches between them. The dashboard lists " +
  "the tenders relevant to the organization's profile, best first, with why each one matches.";
/** The appointment reminders request of the reminders + messaging combination (ADR-0070). */
export const REMINDERS_PROMPT =
  'Build an online booking site for "Norte Dental", a dental clinic with two dentists and 30-minute check-ups ' +
  "(Monday–Friday 09:00–18:00, Europe/Madrid). Patients book on a public page, get a confirmation email with a cancel " +
  "link, and a reminder 24 hours before each appointment by email, and by SMS or WhatsApp when they agree to it.";

export interface Combination {
  /** "ai-agents" or "ai-agents+domain.bookings.turbineh". */
  name: string;
  recipe: string;
  prompt: string;
  /** Native components assembled with the recipe besides what the pipeline selects by code (ADR-0041). */
  with?: string[];
  /** Request parameters per component (what the compiler writes to its params file); defaults otherwise. */
  params?: Record<string, Record<string, unknown>>;
  /** Entities of the spec (generated CRUD), when the combination needs some. */
  entities?: BuildSpec["entities"];
}

/**
 * Recipe + component combinations shown assembled and verified (ADR-0041): the business patterns the learning round
 * found missing (bench/frontiers/ANALYSIS.md §12, G1), each with the request it comes from and the parameters a
 * compiler would write for it. `verify:recipe <name>` runs one; `--all` runs them all.
 */
const STAGES = ["thrown", "trimmed", "bisque_fired", "glazed", "glaze_fired", "ready", "sold"];
const stageLabel = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");

export const COMPONENT_COMBINATIONS: Omit<Combination, "name">[] = [
  {
    // Kilnwise (learning round, tracker): stages with date and person, per-stage limits, history not editable.
    recipe: "tracker",
    with: ["domain.workflow.turbineh"],
    prompt:
      'Build "Kilnwise", a production tracker for a ceramics studio. Visual identity: terracotta `#C2522D`, sand ' +
      "`#EFE6DA`, dark brown text. Each piece goes through stages (thrown, trimmed, bisque fired, glazed, glaze fired, " +
      "ready, sold) with the date and the person for every change. Alerts when a piece has been in a stage longer than " +
      "the stage's limit. Every stage change is recorded and cannot be edited afterwards.",
    params: {
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "piece",
            label: "Piece",
            plural: "Pieces",
            initial: "thrown",
            dueDate: false,
            createRoles: ["*"],
            states: STAGES.map((key) => ({
              key,
              label: stageLabel(key),
              limitHours:
                { thrown: 48, trimmed: 72, bisque_fired: 120, glazed: 72, glaze_fired: 96 }[key] ??
                null,
              final: key === "sold",
            })),
            transitions: STAGES.slice(0, -1).map((from, i) => ({
              from: [from],
              to: STAGES[i + 1] as string,
              label: `Mark ${stageLabel(STAGES[i + 1] as string).toLowerCase()}`,
              roles: ["*"],
            })),
          },
        ],
      },
    },
  },
  {
    // Fieldnote (learning round, saas-crud): roles owner/editor/viewer, invitations, audit log visible to owners.
    recipe: "saas-crud",
    with: ["domain.membership-access.turbineh", "domain.audit-log.turbineh"],
    prompt:
      'Build "Fieldnote", a small SaaS where teams keep a library of customer interview notes. Visual identity: white ' +
      "background, ink text `#1B1F3B`, violet accents `#6C4CF1`, rounded cards. Teams sign up, create a workspace and " +
      "invite teammates by email with roles (owner, editor, viewer: viewers cannot edit). Every change is recorded in " +
      "an audit log visible to owners.",
    entities: [
      {
        name: "Note",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "customerCompany", type: "string", required: true },
          { name: "interviewDate", type: "date", required: true },
          { name: "tags", type: "string", required: false },
          { name: "body", type: "text", required: true },
        ],
      },
    ],
    params: {
      "domain.membership-access.turbineh": {
        roles: [
          {
            key: "owner",
            label: "Owner",
            can: [
              "read",
              "create",
              "update",
              "delete",
              "manage_members",
              "view_audit",
              "see_all_scopes",
            ],
          },
          {
            key: "editor",
            label: "Editor",
            can: ["read", "create", "update", "delete", "see_all_scopes"],
          },
          { key: "viewer", label: "Viewer", can: ["read", "see_all_scopes"] },
        ],
        defaultRole: "viewer",
        inviteRoles: ["editor", "viewer"],
        invitationDays: 7,
        scope: null,
      },
    },
  },
  {
    // Orbit Notes (learning round, landing-waitlist): double opt-in, position, referral link, +5 places per
    // confirmed referral, owner export and removal.
    recipe: "landing-waitlist",
    with: ["growth.waitlist.turbineh"],
    prompt:
      'Build the launch landing page of "Orbit Notes", a note-taking app for students. Visual identity: midnight blue ' +
      "`#0D1B3E` background, electric lime `#C6FF3D` call-to-action, white text, playful sans-serif. Sections: hero " +
      "with a waitlist form, three benefits, how it works, FAQ, footer. The waitlist stores the email with double " +
      "opt-in (a confirmation link sent by email, logged when no provider is configured), shows each confirmed person " +
      "their position and a referral link; every confirmed referral moves the referrer up by five positions. The owner " +
      "signs in to see the list, export it as CSV and remove entries.",
    params: {
      "growth.waitlist.turbineh": {
        doubleOptIn: true,
        showPosition: true,
        referral: { enabled: true, boost: 5 },
        ownerCanExport: true,
        ownerCanRemove: true,
      },
    },
  },
  {
    // Altamira (learning round, corporate-site): projects portfolio with filters by sector and a page per project,
    // careers with open positions, team; SEO metadata, sitemap, Open Graph images.
    recipe: "corporate-site",
    with: ["site.public-pages.turbineh"],
    prompt:
      'Build the website of "Altamira Engineering", a structural engineering firm. Visual identity: charcoal ' +
      "`#222831`, white, signal orange `#FF6B1A` for buttons, serif headings. Pages: home with hero and key figures, " +
      "services (four services, each with its own page), projects portfolio with filters by sector and a page per " +
      "project, team, careers with open positions, and contact with a form (name, email, company, message, consent) " +
      "that is stored, rate-limited, protected against spam and emailed to the firm. Staff sign in to edit projects " +
      "and positions and read contact requests. Good SEO: metadata, sitemap, robots, Open Graph images.",
    params: {
      "site.public-pages.turbineh": {
        pages: [
          { entity: "Project", path: "/projects", detail: true, filters: ["sector"] },
          {
            entity: "JobPosition",
            path: "/careers",
            detail: true,
            filters: ["location"],
            title: "Careers",
          },
          { entity: "TeamMember", path: "/team", detail: false, filters: [], title: "Team" },
        ],
        seo: true,
      },
    },
  },
  {
    // Brightside (learning round, analytics-dashboard): CSV of daily sales validated all-or-nothing with a report,
    // revenue and units by day/week/month, top products, shops vs previous period, filters, chart CSV exports; shop
    // managers see only their shop.
    recipe: "analytics-dashboard",
    with: ["domain.membership-access.turbineh", "data.analytics-import.turbineh"],
    prompt:
      'Build a sales analytics dashboard for "Brightside Coffee", a chain of six coffee shops. Visual identity: ' +
      "espresso brown `#3E2723`, cream `#FFF8E7`, caramel `#D4A373` charts. Managers upload daily sales as CSV (date, " +
      "shop, product, quantity, revenue); invalid rows are rejected with a clear report and never half-imported. The " +
      "dashboard shows revenue and units by day, week and month, top products, comparison between shops and versus the " +
      "previous period, with filters by date range and shop; every chart can be exported as CSV. Shop managers see " +
      "only their shop; the owner sees all.",
    params: {
      "domain.membership-access.turbineh": {
        roles: [
          {
            key: "owner",
            label: "Owner",
            can: [
              "read",
              "create",
              "update",
              "delete",
              "manage_members",
              "view_audit",
              "see_all_scopes",
            ],
          },
          { key: "shop_manager", label: "Shop manager", can: ["read", "create"] },
        ],
        defaultRole: "shop_manager",
        inviteRoles: ["shop_manager"],
        invitationDays: 7,
        scope: { kind: "shop", label: "Shop", plural: "Shops" },
      },
      "data.analytics-import.turbineh": {
        entity: "DailySale",
        columns: ["date", "shop", "product", "quantity", "revenue"],
        atomic: true,
        errorReport: true,
        periods: ["day", "week", "month"],
        compareWithPreviousPeriod: true,
        filters: ["date range", "shop"],
        exportCsv: true,
      },
    },
  },
  {
    // Brickline (learning round, projects): tasks with statuses on a kanban board with drag and drop, file attachments,
    // overdue tasks emailed every morning (logged without an email provider).
    recipe: "projects",
    with: [
      "domain.workflow.turbineh",
      "ui.kanban.turbineh",
      "storage.private-uploads.turbineh",
      "jobs.scheduled.turbineh",
    ],
    prompt:
      'Build "Brickline", a project management tool for a small construction company. Visual identity: slate ' +
      "`#2F3A45`, safety yellow `#FFC300` accents. Projects have phases, tasks (title, assignee, due date, status, " +
      "priority) and a Kanban board per project with drag-and-drop between statuses; each task has comments and file " +
      'attachments. Members see only the projects they belong to; managers create projects and assign people. A "my ' +
      'tasks" page lists what is due this week, and overdue tasks are emailed to the assignee every morning (log it ' +
      "when no email provider is configured).",
    params: {
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "task",
            label: "Task",
            plural: "Tasks",
            initial: "todo",
            dueDate: true,
            createRoles: ["*"],
            states: [
              { key: "todo", label: "To do", limitHours: null, final: false },
              { key: "in_progress", label: "In progress", limitHours: 120, final: false },
              { key: "done", label: "Done", limitHours: null, final: true },
            ],
            transitions: [
              { from: ["todo"], to: "in_progress", label: "Start", roles: ["*"] },
              { from: ["in_progress"], to: "done", label: "Complete", roles: ["*"] },
              { from: ["in_progress"], to: "todo", label: "Back to do", roles: ["*"] },
            ],
          },
        ],
      },
      "ui.kanban.turbineh": { workflows: ["task"], dragAndDrop: true, highlightOverdue: true },
      "storage.private-uploads.turbineh": {
        maxBytes: 10 * 1024 * 1024,
        types: ["pdf", "png", "jpg"],
        maxFilesPerRecord: 20,
        notifyOnUpload: false,
      },
      "jobs.scheduled.turbineh": {
        jobs: [
          {
            id: "overdue-reminders",
            kind: "overdue-digest",
            cron: "0 7 * * *",
            timeZone: "UTC",
            what: "Overdue tasks are emailed to the assignee every morning",
          },
        ],
        logWhenNoEmailProvider: true,
      },
    },
  },
  {
    // Pixelyard (learning round, internal-tool): loans requested by staff, approved or rejected by a manager, returned;
    // overdue loans highlighted and the borrower emailed (logged without an email provider).
    recipe: "internal-tool",
    with: ["domain.workflow.turbineh", "jobs.scheduled.turbineh"],
    prompt:
      'Build an internal equipment-loan tool for "Pixelyard", a video production company. Visual identity: black, ' +
      "white and red `#E63946`. Staff sign in with company emails only (@pixelyard.test). Equipment items have a name, " +
      "category, serial number, condition and photo URL. Staff request items for a date range; a manager approves or " +
      "rejects; an item cannot be lent twice for overlapping dates. Returns are checked in with condition notes; overdue " +
      "loans are highlighted and the borrower is emailed (log it when no email provider is configured). Managers see a " +
      "dashboard of utilisation per category and export loans as CSV.",
    params: {
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "loan",
            label: "Loan",
            plural: "Loans",
            initial: "requested",
            dueDate: true,
            createRoles: ["*"],
            states: [
              { key: "requested", label: "Requested", limitHours: 48, final: false },
              { key: "approved", label: "Approved", limitHours: null, final: false },
              { key: "rejected", label: "Rejected", limitHours: null, final: true },
              { key: "returned", label: "Returned", limitHours: null, final: true },
            ],
            transitions: [
              { from: ["requested"], to: "approved", label: "Approve", roles: ["owner", "admin"] },
              { from: ["requested"], to: "rejected", label: "Reject", roles: ["owner", "admin"] },
              {
                from: ["approved"],
                to: "returned",
                label: "Check in",
                roles: ["owner", "admin", "creator"],
              },
            ],
          },
        ],
      },
      "jobs.scheduled.turbineh": {
        jobs: [
          {
            id: "overdue-reminders",
            kind: "overdue-digest",
            cron: "0 8 * * *",
            timeZone: "UTC",
            what: "Overdue loans are emailed to the borrower",
          },
        ],
        logWhenNoEmailProvider: true,
      },
    },
  },
  {
    // Sala Nueve (learning round, bookings): public booking page, stylist or any, cancel link up to 12 hours before,
    // no double bookings, staff day/week calendar per stylist, time off, staff move/cancel with customer emails.
    // Parameters come from the request through detectDomains (recipe bookings requires domain.bookings).
    recipe: "bookings",
    with: ["domain.bookings.turbineh"],
    prompt:
      'Build an online booking site for "Sala Nueve", a hair salon with four stylists. Services: cut 30 min (25 €), ' +
      "colour 90 min (70 €), cut and colour 120 min (90 €). Opening hours Tuesday–Saturday 10:00–20:00, Europe/Madrid. " +
      "Customers pick a service, a stylist (or any) and a free slot, enter name, email and phone, and receive a " +
      "confirmation email with a link to cancel up to 12 hours before. No double bookings, ever. Staff sign in to see " +
      "the day and week calendar per stylist, block time off and move or cancel bookings (the customer is emailed). No AI.",
  },
  {
    // Ledgerline (learning round, client-portal): staff/client roles, a client sees only their company, private
    // uploads (PDF/JPG/PNG up to 10 MB) downloadable by that client and staff, document requests pending → received →
    // approved with due dates, staff emailed when a client uploads.
    recipe: "client-portal",
    with: [
      "domain.membership-access.turbineh",
      "storage.private-uploads.turbineh",
      "domain.workflow.turbineh",
    ],
    prompt:
      'Build a client portal for "Ledgerline", a small accounting firm. Visual identity: deep green `#0B3D2E`, cream ' +
      "background `#F7F3EA`, gold highlights `#C9A227`. Staff create client accounts and invite each client by email; a " +
      "client only ever sees their own company. Clients upload documents (PDF/JPG/PNG up to 10 MB, stored privately, " +
      "downloadable only by that client and staff), see a list of document requests with due dates and statuses " +
      "(pending, received, approved), and exchange messages with the firm per request. Staff see all clients, change " +
      "statuses and get an email when a client uploads (log it when no email provider is configured).",
    params: {
      "domain.membership-access.turbineh": {
        roles: [
          {
            key: "owner",
            label: "Owner",
            can: [
              "read",
              "create",
              "update",
              "delete",
              "manage_members",
              "view_audit",
              "see_all_scopes",
            ],
          },
          {
            key: "staff",
            label: "Staff",
            can: ["read", "create", "update", "delete", "manage_members", "see_all_scopes"],
          },
          { key: "client", label: "Client", can: ["read", "create"] },
        ],
        defaultRole: "client",
        inviteRoles: ["staff", "client"],
        invitationDays: 7,
        scope: { kind: "company", label: "Company", plural: "Companies" },
      },
      "storage.private-uploads.turbineh": {
        maxBytes: 10 * 1024 * 1024,
        types: ["pdf", "jpg", "png"],
        maxFilesPerRecord: 20,
        notifyOnUpload: true,
      },
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "request",
            label: "Document request",
            plural: "Document requests",
            initial: "pending",
            dueDate: true,
            createRoles: ["owner", "staff"],
            states: [
              { key: "pending", label: "Pending", limitHours: null, final: false },
              { key: "received", label: "Received", limitHours: 72, final: false },
              { key: "approved", label: "Approved", limitHours: null, final: true },
            ],
            transitions: [
              {
                from: ["pending"],
                to: "received",
                label: "Mark received",
                roles: ["owner", "staff"],
              },
              { from: ["received"], to: "approved", label: "Approve", roles: ["owner", "staff"] },
              { from: ["received"], to: "pending", label: "Ask again", roles: ["owner", "staff"] },
            ],
          },
        ],
      },
    },
  },
  {
    // Crumb & Co (audit v2 §6, without autonomy or AI drafts — ADR-0067): connect LinkedIn, Facebook + Instagram and
    // X, approve, schedule, publish with retries and a log, calendar, engagement metrics.
    recipe: "saas-crud",
    with: ["social.connections.turbineh", "social.publish.turbineh", "social.metrics.turbineh"],
    prompt: SOCIAL_PUBLISHER_PROMPT,
    params: {
      "social.connections.turbineh": { providers: ["linkedin", "meta", "x"] },
      "social.publish.turbineh": {
        networks: ["linkedin", "facebook", "instagram", "x"],
        requireApproval: true,
        maxAttempts: 5,
      },
      "social.metrics.turbineh": { refreshHours: 6, windowDays: 30 },
    },
  },
  {
    // Blog on a landing page (ADR-0073): posts with authors, tags, reading time, drafts, RSS, sitemap and JSON-LD.
    recipe: "landing-waitlist",
    with: ["content.blog.turbineh"],
    prompt: BLOG_PROMPT,
    params: {
      "content.blog.turbineh": { postsPerPage: 10, wordsPerMinute: 200, feedItems: 20 },
    },
  },
  {
    // Screen + camera recorder (ADR-0073): up to 4K asked, layouts on a canvas, private storage, share links.
    recipe: "saas-crud",
    with: ["storage.private-uploads.turbineh", "media.screen-recording.turbineh"],
    prompt: RECORDER_PROMPT,
    params: {
      "media.screen-recording.turbineh": {
        maxResolution: "2160p",
        frameRate: 30,
        layouts: ["bubble", "side-by-side", "screen-only", "camera-only"],
        maxMinutes: 30,
        maxBytes: 524_288_000,
        shareLinks: true,
      },
    },
  },
  {
    // B2B opportunity monitoring (ADR-0073): roles, organization switcher, profile, deterministic matches.
    recipe: "saas-crud",
    with: ["domain.membership-access.turbineh", "domain.matching.turbineh"],
    prompt: MATCHING_PROMPT,
    params: {
      "domain.matching.turbineh": {
        entity: { singular: "tender", plural: "tenders" },
        weights: { sectors: 3, activities: 2, regions: 2, keywords: 1 },
        minScore: 1,
      },
    },
  },
  {
    // Appointment reminders (ADR-0070): a clinic reminds patients 24 hours before each appointment by email, SMS or
    // WhatsApp — SMS and WhatsApp only to those who tick the box; Twilio and the WhatsApp Cloud API as offline mocks.
    recipe: "bookings",
    with: [
      "domain.bookings.turbineh",
      "domain.reminders.turbineh",
      "messaging.sms.twilio",
      "messaging.whatsapp.meta",
    ],
    prompt: REMINDERS_PROMPT,
    params: {
      "domain.reminders.turbineh": {
        hoursBefore: 24,
        channels: ["email", "sms", "whatsapp"],
        whatsappTemplate: { name: "appointment_reminder", language: "en" },
        maxAttempts: 3,
      },
      "messaging.sms.twilio": { defaultCountry: "ES", maxAttempts: 3 },
      "messaging.whatsapp.meta": { defaultCountry: "ES", maxAttempts: 3 },
      "jobs.scheduled.turbineh": { jobs: [], logWhenNoEmailProvider: true },
    },
  },
];

/** Every recipe alone, every recipe a domain component's probe selects it for, and COMPONENT_COMBINATIONS. */
export function combinations(repoRoot: string): Combination[] {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const recipes = readdirSync(recipesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(recipesDir, d.name, "recipe.yaml")))
    .map((d) => d.name)
    .sort();
  const out: Combination[] = recipes.map((recipe) => ({ name: recipe, recipe, prompt: "" }));
  const explicit = new Set(
    COMPONENT_COMBINATIONS.map((c) => [c.recipe, ...(c.with ?? [])].join("+")),
  );
  for (const recipe of recipes) {
    for (const [component, prompt] of Object.entries(DOMAIN_PROBES)) {
      const name = `${recipe}+${component}`;
      // A combination with its own request (e.g. Sala Nueve for bookings) replaces the generic probe.
      if (explicit.has(name)) continue;
      if (detectDomains(prompt, recipe).some((d) => d.component === component)) {
        out.push({ name, recipe, prompt });
      }
    }
  }
  for (const c of COMPONENT_COMBINATIONS)
    out.push({ ...c, name: [c.recipe, ...(c.with ?? [])].join("+") });
  return out;
}

/** The minimal spec used for template checks (no models involved). */
export function checkSpec(
  recipe: string,
  prompt: string,
  entities: BuildSpec["entities"] = [],
): BuildSpec {
  return {
    recipe: recipe as BuildSpec["recipe"],
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Recipe Check",
    slug: "recipe-check",
    summary: `Verification of the ${recipe} recipe template.`,
    roles: ["owner"],
    entities,
    pages: [{ path: "/", purpose: "Home", auth_required: false }],
    capabilities: ["security.headers", "data.validation"],
    acceptance_criteria: [
      "Owner signs in and reaches the dashboard",
      "Anonymous users are sent to sign-in",
      "Every action checks the workspace",
    ],
    site: null,
    palette: extractPalette(prompt),
  };
}

/**
 * Native components the pipeline vendors for this recipe and request, chosen by code as the pipeline does: the
 * recipe's required components, the detected domain components, native components for the recipe's default and
 * always-on capabilities, their `requires`, and `extra` ids (--with).
 */
export function nativeSelection(
  repoRoot: string,
  recipe: string,
  prompt: string,
  extra: string[] = [],
): { selected: SelectedComponent[]; domains: ReturnType<typeof detectDomains> } {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const merged = mergedRecipe(recipeChain(recipesDir, recipe));
  const catalog = loadCatalog(join(repoRoot, "catalog/components"), { cards: "oneliner" });
  const approved = (c: CandidateCard) => c.status === "approved";
  const native = (c: CandidateCard) => c.pkg.name.startsWith("turbineh/");
  const domains = detectDomains(prompt, recipe, "Recipe Check");
  const ids = new Set<string>([
    ...Object.values(merged.requiredComponents ?? {}),
    ...domains.map((d) => d.component),
    ...extra,
  ]);
  const provided = new Set(merged.providedCapabilities ?? []);
  for (const cap of [...merged.defaultCapabilities, ...ALWAYS_ON]) {
    if (provided.has(cap)) continue;
    const c = catalog.find((x) => approved(x) && native(x) && x.provides.includes(cap));
    if (c) ids.add(c.id);
  }
  // Requirements between components (e.g. the orchestrator requires the AI Safety Pack).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...ids]) {
      for (const r of catalog.find((x) => x.id === id)?.requires ?? []) {
        if (!ids.has(r) && catalog.some((x) => x.id === r)) {
          ids.add(r);
          changed = true;
        }
      }
    }
  }
  const selected = [...ids].map((id): SelectedComponent => {
    const c = catalog.find((x) => x.id === id);
    if (!c) throw new Error(`unknown component ${id}`);
    return {
      capability: c.provides[0] ?? id.split(".").slice(0, 2).join("."),
      component: c,
      why: { pBest: 1, covers: 1, risk: 0 },
    };
  });
  return { selected, domains };
}

/** Assembles one combination into `outDir` the way the pipeline does. */
export function assembleCombination(
  repoRoot: string,
  c: Pick<Combination, "recipe" | "prompt" | "with" | "params" | "entities">,
  outDir: string,
  extra: string[] = [],
): { components: string[]; domains: string[] } {
  const { selected, domains } = nativeSelection(repoRoot, c.recipe, c.prompt, [
    ...(c.with ?? []),
    ...extra,
  ]);
  // Parameters of the combination (what the compiler would extract from the request), written like detected domains.
  const componentsDir = join(repoRoot, "catalog/components");
  const given = Object.entries(c.params ?? {}).map(([component, params]) => {
    const errors = validateParams(join(componentsDir, component), params);
    if (errors.length) throw new Error(`${component} params: ${errors.join("; ")}`);
    const decl = readParamsDecl(join(componentsDir, component));
    return {
      id: component,
      capability: component.split(".").slice(0, 2).join("."),
      component,
      recipes: [c.recipe],
      paramsFile: decl?.file ?? "",
      params,
      providedEntities: decl?.entities ?? [],
      assumptions: [],
    };
  });
  const all = [...domains, ...given];
  assemble({
    buildId: "recipe-check",
    recipesDir: join(repoRoot, "catalog/recipes"),
    recipe: c.recipe,
    outDir,
    spec: checkSpec(c.recipe, c.prompt, c.entities ?? []),
    selected,
    gaps: [],
    domains: all,
  });
  return {
    components: selected.map((s) => s.component.id),
    domains: domains.map((d) => d.component),
  };
}

import type { BuildSpec } from "../build-spec.js";
import type { EntityKind, RelationshipShape } from "./entity-kinds.js";
import type { Action, OrgRole } from "./permissions.js";
import type { PatternId } from "./patterns.js";

/**
 * The 9 learning-round specs (`bench/frontiers/learning.md` on `wip/frontiers-bench`, 2026-10-13) with the BuildSpec
 * the compiler model produced for each: entity names from each package's `.turbineh/owners.json`, fields from the
 * package's generated tables where they survive (the coding agent deleted the rest), criteria from
 * `.turbineh/acceptance.json`. `expected` is the modelling a person would do from the request (ADR-0042) and is what
 * the regression tests check.
 */
export interface LearningSpec {
  id: string;
  prompt: string;
  spec: BuildSpec;
  /** Entities the recipe implements (parents such as Task). */
  recipeEntities: string[];
  expected: {
    kinds: Record<string, { kind: EntityKind; shape?: RelationshipShape; parent?: string | null }>;
    /** Label of the spec role each workspace role maps to. */
    roles: Record<OrgRole, string>;
    /** Allowed (true) or refused (false) actions per workspace role, with an optional resource. */
    can: [OrgRole, Action, boolean, string?][];
    scope?: { role: OrgRole; kind: "own" | "membership"; of: string };
    signUpEmailDomains?: string[];
    timeZone: string;
    constraints?: {
      maxBytes?: number;
      types?: string[];
      statuses?: string[];
      noticeHours?: number;
      cron?: string;
      openingDays?: number[];
      currency?: string;
      boost?: number;
      sort?: { field: string; direction: "asc" | "desc" };
    };
    patterns: PatternId[];
  };
}

const f = (
  name: string,
  type: BuildSpec["entities"][number]["fields"][number]["type"],
  required = true,
) => ({ name, type, required });

const base = (
  recipe: BuildSpec["recipe"],
  app_name: string,
  summary: string,
  roles: string[],
  entities: BuildSpec["entities"],
  acceptance_criteria: string[],
): BuildSpec => ({
  recipe,
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name,
  slug: app_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  summary,
  roles,
  entities,
  pages: [{ path: "/dashboard", purpose: "Dashboard", auth_required: true }],
  capabilities: ["auth.session", "authz.roles", "data.validation", "security.headers"],
  acceptance_criteria,
  site: null,
  palette: null,
});

export const LEARNING_SPECS: LearningSpec[] = [
  {
    id: "saas-crud",
    prompt:
      'Build "Fieldnote", a small SaaS where teams keep a library of customer interview notes. Visual identity: white background, ink text `#1B1F3B`, violet accents `#6C4CF1`, rounded cards. Teams sign up, create a workspace and invite teammates by email with roles (owner, editor, viewer: viewers cannot edit). Notes have a title, customer company, interview date, tags and a long body; list them with search, tag filter, sorting by date and pagination, and export the filtered list as CSV. Every change is recorded in an audit log visible to owners.',
    recipeEntities: [],
    spec: base(
      "saas-crud",
      "Fieldnote",
      "A library of customer interview notes for teams, with roles, tags, search and an audit log.",
      ["owner", "editor", "viewer"],
      [
        {
          name: "Note",
          fields: [
            f("title", "string"),
            f("customerCompany", "string"),
            f("interviewDate", "date"),
            f("body", "text"),
          ],
        },
        { name: "Tag", fields: [f("name", "string")] },
        { name: "NoteTag", fields: [f("noteId", "reference"), f("tagId", "reference")] },
        { name: "WorkspaceMember", fields: [f("email", "email"), f("role", "enum")] },
      ],
      [
        "Given a new user, when they sign up, a workspace is created and they are assigned the 'owner' role.",
        "Given an owner, when they invite a teammate via email, the teammate is assigned the specified role (owner, editor, or viewer).",
        "Given a viewer, when they attempt to edit a note, the system denies the request.",
        "Given a note, when it is saved, it must contain a title, customer company, interview date, tags, and a body.",
        "Given the notes list, when a user searches by text, the list updates to show only matching notes.",
        "Given the notes list, when a tag filter is applied, the list updates to show only notes containing that tag.",
        "Given the notes list, when a sort order is selected, the notes are reordered by interview date.",
        "Given the notes list, when the number of notes exceeds the limit, pagination controls are displayed.",
        "Given a filtered list of notes, when the user clicks export, a CSV file containing only the filtered results is downloaded.",
        "Given a change to any note, when an owner views the audit log, the change is recorded and visible.",
        "Given a non-owner user, when they attempt to access the audit log, the system denies access.",
      ],
    ),
    expected: {
      kinds: {
        Note: { kind: "business" },
        Tag: { kind: "relationship", shape: "tags", parent: "Note" },
        NoteTag: { kind: "relationship", shape: "tags", parent: "Note" },
        WorkspaceMember: { kind: "relationship", shape: "membership", parent: null },
      },
      roles: { owner: "Owner", admin: "Editor", member: "Viewer" },
      can: [
        ["member", "read", true],
        ["member", "update", false],
        ["member", "create", false],
        ["member", "delete", false],
        ["admin", "update", true],
        ["admin", "view_audit", false],
        ["owner", "view_audit", true],
        ["owner", "manage_members", true],
      ],
      timeZone: "UTC",
      constraints: { sort: { field: "date", direction: "desc" } },
      patterns: ["membership-access", "audit-log"],
    },
  },
  {
    id: "client-portal",
    prompt:
      'Build a client portal for "Ledgerline", a small accounting firm. Visual identity: deep green `#0B3D2E`, cream background `#F7F3EA`, gold highlights `#C9A227`. Staff create client accounts and invite each client by email; a client only ever sees their own company. Clients upload documents (PDF/JPG/PNG up to 10 MB, stored privately, downloadable only by that client and staff), see a list of document requests with due dates and statuses (pending, received, approved), and exchange messages with the firm per request. Staff see all clients, change statuses and get an email when a client uploads (log it when no email provider is configured).',
    recipeEntities: ["Request", "Document", "Attachment", "File", "Upload"],
    spec: base(
      "client-portal",
      "Ledgerline",
      "A client portal where an accounting firm requests documents from client companies.",
      ["staff", "client"],
      [
        { name: "Company", fields: [f("name", "string"), f("contactEmail", "email", false)] },
        {
          name: "DocumentRequest",
          fields: [
            f("title", "string"),
            f("companyId", "reference"),
            f("dueDate", "date"),
            f("status", "enum"),
          ],
        },
        {
          name: "Message",
          fields: [
            f("documentRequestId", "reference"),
            f("body", "text"),
            f("senderRole", "string"),
          ],
        },
      ],
      [
        "Staff can create a company account and send an email invitation to a specific client email address.",
        "A client user can only access and view data belonging to their assigned company.",
        "Clients can upload files in PDF, JPG, or PNG formats up to a maximum size of 10 MB.",
        "Uploaded documents are stored privately and are only downloadable by the owner client or staff members.",
        "Clients can view a list of document requests including their due dates and current statuses (pending, received, approved).",
        "Clients can send and receive messages specifically linked to a document request.",
        "Staff can view a comprehensive list of all registered client companies.",
        "Staff can manually update the status of a document request.",
        "Staff receive an email notification when a client uploads a new document.",
        "The system logs a notification event when no email provider is configured during a document upload.",
      ],
    ),
    expected: {
      kinds: {
        Company: { kind: "business" },
        DocumentRequest: { kind: "business" },
        Message: { kind: "relationship", shape: "child", parent: "DocumentRequest" },
      },
      roles: { owner: "Staff", admin: "Staff", member: "Client" },
      can: [
        ["member", "approve", false],
        ["admin", "approve", true],
        ["member", "read", true],
        ["member", "create", true],
      ],
      scope: { role: "member", kind: "own", of: "company" },
      timeZone: "UTC",
      constraints: {
        maxBytes: 10 * 1024 * 1024,
        types: ["application/pdf", "image/jpeg", "image/png"],
        statuses: ["pending", "received", "approved"],
      },
      patterns: ["workflow", "membership-access", "private-uploads"],
    },
  },
  {
    id: "corporate-site",
    prompt:
      'Build the website of "Altamira Engineering", a structural engineering firm. Visual identity: charcoal `#222831`, white, signal orange `#FF6B1A` for buttons, serif headings. Pages: home with hero and key figures, services (four services, each with its own page), projects portfolio with filters by sector and a page per project, team, careers with open positions, and contact with a form (name, email, company, message, consent) that is stored, rate-limited, protected against spam and emailed to the firm. Staff sign in to edit projects and positions and read contact requests. Good SEO: metadata, sitemap, robots, Open Graph images.',
    recipeEntities: ["Page", "Service", "ContactMessage", "Lead"],
    spec: base(
      "corporate-site",
      "Altamira Engineering",
      "The website of a structural engineering firm with services, portfolio, team, careers and contact.",
      ["staff"],
      [
        {
          name: "ContactRequest",
          fields: [
            f("name", "string"),
            f("email", "email"),
            f("company", "string", false),
            f("message", "text"),
            f("consentGiven", "boolean"),
          ],
        },
        {
          name: "JobPosition",
          fields: [
            f("title", "string"),
            f("description", "text"),
            f("location", "string", false),
            f("isActive", "boolean"),
          ],
        },
        {
          name: "Project",
          fields: [
            f("title", "string"),
            f("slug", "string"),
            f("description", "text"),
            f("sector", "string"),
            f("imageUrl", "file"),
          ],
        },
        {
          name: "TeamMember",
          fields: [
            f("name", "string"),
            f("role", "string"),
            f("imageUrl", "file"),
            f("bio", "text", false),
          ],
        },
      ],
      [
        "Given a user visits the Home page, they should see a hero section and key figures displayed.",
        "Given a user navigates to the Services section, they should be able to access individual pages for each of the four services.",
        "Given a user views the Projects portfolio, they should be able to filter projects by sector.",
        "Given a user selects a project from the portfolio, they should be directed to a dedicated project page.",
        "Given a user visits the Team page, they should see the staff members.",
        "Given a user visits the Careers page, they should see a list of open positions.",
        "Given a user submits the Contact form with valid data, the request should be stored in the database and emailed to the firm.",
        "Given a user submits the Contact form, the system should enforce rate-limiting and spam protection.",
        "Given a staff member signs in, they should be able to edit projects and open positions.",
        "Given a staff member signs in, they should be able to read contact requests.",
        "Given a web crawler visits the site, it should find valid metadata, a sitemap, a robots.txt, and Open Graph images.",
      ],
    ),
    expected: {
      kinds: {
        ContactRequest: { kind: "business" },
        JobPosition: { kind: "business" },
        Project: { kind: "business" },
        TeamMember: { kind: "business" },
      },
      // A single named role is the owner and admin; invited members never inherit it (ADR-0054).
      roles: { owner: "Staff", admin: "Staff", member: "Member" },
      can: [
        ["owner", "update", true],
        ["admin", "update", true],
        ["member", "update", false],
        ["member", "configure", false],
        ["member", "manage_members", false],
      ],
      timeZone: "UTC",
      patterns: ["site.public-pages"],
    },
  },
  {
    id: "landing-waitlist",
    prompt:
      'Build the launch landing page of "Orbit Notes", a note-taking app for students. Visual identity: midnight blue `#0D1B3E` background, electric lime `#C6FF3D` call-to-action, white text, playful sans-serif. Sections: hero with a waitlist form, three benefits, how it works, FAQ, footer. The waitlist stores the email with double opt-in (a confirmation link sent by email, logged when no provider is configured), shows each confirmed person their position and a referral link; every confirmed referral moves the referrer up by five positions. The owner signs in to see the list, export it as CSV and remove entries.',
    recipeEntities: ["WaitlistEntry", "Subscriber", "Signup", "Lead"],
    spec: base(
      "landing-waitlist",
      "Orbit Notes",
      "Launch landing page with a waitlist, double opt-in and referral positions.",
      ["owner"],
      [],
      [
        "Given a visitor on the landing page, when they submit a valid email in the hero section, then the system must store the email and trigger a double opt-in confirmation email.",
        "Given a confirmed user has a referral link, when a new user signs up using that link and confirms their email, then the referrer's waitlist position must increase by five.",
        "Given an authenticated owner, when they access the admin dashboard, then they must see the full list of waitlist entries.",
        "Given an authenticated owner, when they select the export option, then the system must generate and download a CSV file containing all waitlist entries.",
        "Given an authenticated owner, when they select a specific entry in the list, then they must be able to delete that entry from the database.",
      ],
    ),
    expected: {
      kinds: {},
      roles: { owner: "Owner", admin: "Owner", member: "Member" },
      can: [
        ["owner", "delete", true],
        ["member", "delete", false],
        ["member", "export", false],
      ],
      timeZone: "UTC",
      constraints: { boost: 5 },
      patterns: ["growth.waitlist"],
    },
  },
  {
    id: "bookings",
    prompt:
      'Build an online booking site for "Sala Nueve", a hair salon with four stylists. Services: cut 30 min (25 €), colour 90 min (70 €), cut and colour 120 min (90 €). Opening hours Tuesday–Saturday 10:00–20:00, Europe/Madrid. Customers pick a service, a stylist (or any) and a free slot, enter name, email and phone, and receive a confirmation email with a link to cancel up to 12 hours before. No double bookings, ever. Staff sign in to see the day and week calendar per stylist, block time off and move or cancel bookings (the customer is emailed). No AI.',
    recipeEntities: ["Booking", "Appointment", "Availability", "Slot"],
    spec: base(
      "bookings",
      "Sala Nueve",
      "Online booking for a hair salon with four stylists, services, opening hours and cancellations.",
      ["staff"],
      [
        {
          name: "Customer",
          fields: [f("name", "string"), f("email", "email"), f("phone", "string")],
        },
        {
          name: "Service",
          fields: [f("name", "string"), f("durationMinutes", "integer"), f("price", "decimal")],
        },
        { name: "Stylist", fields: [f("name", "string")] },
        {
          name: "TimeBlock",
          fields: [
            f("stylistId", "reference"),
            f("startsAt", "datetime"),
            f("endsAt", "datetime"),
            f("reason", "string", false),
          ],
        },
      ],
      [
        "Given a customer selects a service, they can only choose time slots that match the service duration.",
        "Given a customer selects a stylist, they can only choose slots where that specific stylist is available.",
        "Given a customer provides a name, email, and phone, the system creates a booking and sends a confirmation email.",
        "Given a customer receives a confirmation email, they can click the link to cancel the booking if it is more than 12 hours before the start time.",
        "Given a customer attempts to book a slot that is already taken, the system prevents the double booking.",
        "Given a staff member signs in, they can view a calendar displaying bookings for the day and week per stylist.",
        "Given a staff member is authenticated, they can block specific time slots to make them unavailable for booking.",
        "Given a staff member is authenticated, they can cancel a booking, triggering an automated email to the customer.",
      ],
    ),
    expected: {
      kinds: {
        Customer: { kind: "business" },
        Service: { kind: "business" },
        Stylist: { kind: "business" },
        TimeBlock: { kind: "business" },
      },
      roles: { owner: "Staff", admin: "Staff", member: "Member" },
      can: [
        ["admin", "update", true],
        ["member", "update", false],
        ["member", "approve", false],
        ["member", "export", false],
      ],
      timeZone: "Europe/Madrid",
      constraints: { noticeHours: 12, openingDays: [2, 3, 4, 5, 6], currency: "EUR" },
      patterns: ["bookings"],
    },
  },
  {
    id: "projects",
    prompt:
      'Build "Brickline", a project management tool for a small construction company. Visual identity: slate `#2F3A45`, safety yellow `#FFC300` accents. Projects have phases, tasks (title, assignee, due date, status, priority) and a Kanban board per project with drag-and-drop between statuses; each task has comments and file attachments. Members see only the projects they belong to; managers create projects and assign people. A "my tasks" page lists what is due this week, and overdue tasks are emailed to the assignee every morning (log it when no email provider is configured).',
    recipeEntities: ["Project", "Task", "Comment", "Board"],
    spec: base(
      "projects",
      "Brickline",
      "A project management tool for a small construction company with phases, tasks and a Kanban board.",
      ["manager", "member"],
      [
        {
          name: "Attachment",
          fields: [
            f("taskId", "reference"),
            f("uploadedById", "reference"),
            f("fileName", "string"),
            f("fileUrl", "string"),
            f("fileSize", "integer"),
            f("mimeType", "string"),
          ],
        },
        {
          name: "Phase",
          fields: [f("projectId", "reference"), f("name", "string"), f("order", "integer")],
        },
        {
          name: "ProjectMembership",
          fields: [f("projectId", "reference"), f("userId", "reference"), f("role", "enum")],
        },
      ],
      [
        "Given a user with the 'member' role, when they attempt to access a project they are not assigned to, then the server must return a 403 Forbidden error.",
        "Given a task on the Kanban board, when a user drags it from 'todo' to 'in_progress', then the new status must be persisted in the database.",
        "Given a task, when a user uploads a file exceeding the size limit, then the system must reject the upload with a validation error.",
        "Given a task, when a user uploads a file, then the file must be stored in a directory outside of the public web directory.",
        "Given a user, when they visit the 'My tasks' page, then they must see a list of tasks assigned to them that are due this week or are overdue.",
        "Given a task, when a user adds a comment, then the comment must be associated with that specific task and visible to project members.",
        "Given the 'pnpm job:overdue' script is executed, when there are overdue tasks, then the system must email the assignees or log the email if no provider is configured.",
        "Given a task, when a user changes its priority to 'urgent', then the priority must be updated in the database.",
        "Given a manager, when they create a new project, then the project must be successfully saved to the PostgreSQL database.",
      ],
    ),
    expected: {
      kinds: {
        Attachment: { kind: "relationship", shape: "child", parent: "Task" },
        Phase: { kind: "relationship", shape: "child", parent: "Project" },
        ProjectMembership: { kind: "relationship", shape: "membership", parent: "Project" },
      },
      roles: { owner: "Manager", admin: "Manager", member: "Member" },
      can: [
        ["member", "create", false, "projects"],
        ["admin", "create", true, "projects"],
        ["member", "create", true],
        ["member", "manage_members", false],
        ["admin", "manage_members", true],
      ],
      scope: { role: "member", kind: "membership", of: "project" },
      timeZone: "UTC",
      constraints: { cron: "0 7 * * *" },
      patterns: ["membership-access", "private-uploads", "jobs.scheduled", "kanban"],
    },
  },
  {
    id: "tracker",
    prompt:
      'Build "Kilnwise", a production tracker for a ceramics studio. Visual identity: terracotta `#C2522D`, sand `#EFE6DA`, dark brown text. Each piece goes through stages (thrown, trimmed, bisque fired, glazed, glaze fired, ready, sold) with the date and the person for every change; pieces have a code, clay body, glaze, size and photo URL. Show a board by stage, a timeline per piece, and alerts when a piece has been in a stage longer than the stage\'s limit (configurable per stage). Staff sign in; every stage change is recorded and cannot be edited afterwards.',
    recipeEntities: ["Tracker", "Habit", "Goal", "Log", "Entry"],
    spec: base(
      "tracker",
      "Kilnwise",
      "A production tracker for a ceramics studio with stages, a board, a timeline and stage limits.",
      ["staff"],
      [
        {
          name: "Piece",
          fields: [
            f("code", "string"),
            f("clayBody", "string"),
            f("glaze", "string", false),
            f("size", "string", false),
            f("photoUrl", "file", false),
            f("stage", "enum"),
          ],
        },
        {
          name: "StageEvent",
          fields: [
            f("pieceId", "reference"),
            f("fromStage", "enum", false),
            f("toStage", "enum"),
            f("changedBy", "string"),
            f("changedAt", "datetime"),
          ],
        },
        { name: "StageLimit", fields: [f("stage", "enum"), f("maxDays", "integer")] },
      ],
      [
        "Given a piece is in a stage, when the stage is changed, then a new append-only event is recorded with the piece code, previous stage, new stage, timestamp, and staff user.",
        "Given a stage event exists in the database, when an update or delete request is sent to the API, then the request is rejected and the record remains unchanged.",
        "Given a stage limit is configured, when a piece remains in its current stage longer than that limit, then the piece card is visually highlighted on the Kanban board.",
        "Given a piece is selected, when the detail view is opened, then it displays a chronological timeline of all stage change events including date and staff name.",
        "Given a new piece is being created, when the metadata is submitted, then the piece is saved with a unique code, clay body, glaze, size, and photo URL.",
        "Given a user is not authenticated, when they attempt to access any screen, then they are redirected to the sign-in page.",
      ],
    ),
    expected: {
      kinds: {
        Piece: { kind: "business" },
        StageEvent: { kind: "event", parent: "Piece" },
        StageLimit: { kind: "configuration" },
      },
      roles: { owner: "Staff", admin: "Staff", member: "Member" },
      can: [
        ["admin", "update", true],
        ["member", "update", false],
        ["member", "approve", false],
        ["member", "export", false],
      ],
      timeZone: "UTC",
      constraints: {
        statuses: ["thrown", "trimmed", "bisque fired", "glazed", "glaze fired", "ready", "sold"],
      },
      patterns: ["workflow", "kanban"],
    },
  },
  {
    id: "internal-tool",
    prompt:
      'Build an internal equipment-loan tool for "Pixelyard", a video production company. Visual identity: black, white and red `#E63946`. Staff sign in with company emails only (@pixelyard.test). Equipment items have a name, category, serial number, condition and photo URL. Staff request items for a date range; a manager approves or rejects; an item cannot be lent twice for overlapping dates. Returns are checked in with condition notes; overdue loans are highlighted and the borrower is emailed (log it when no email provider is configured). Managers see a dashboard of utilisation per category and export loans as CSV.',
    recipeEntities: [],
    spec: base(
      "internal-tool",
      "Pixelyard",
      "An internal equipment-loan tool with approvals, overlap checks, returns and utilisation.",
      ["staff", "manager"],
      [
        {
          name: "EquipmentItem",
          fields: [
            f("name", "string"),
            f("category", "string"),
            f("serialNumber", "string"),
            f("condition", "string"),
            f("photoUrl", "file", false),
          ],
        },
        {
          name: "LoanRequest",
          fields: [
            f("equipmentItemId", "reference"),
            f("startDate", "date"),
            f("endDate", "date"),
            f("status", "enum"),
            f("conditionNotes", "text", false),
          ],
        },
        {
          name: "EmailLog",
          fields: [
            f("to", "email"),
            f("subject", "string"),
            f("body", "text"),
            f("sentAt", "datetime"),
          ],
        },
      ],
      [
        "Given a user attempts to sign up with a non-@pixelyard.test email, the server rejects the registration.",
        "Given a user is logged in, they can create, read, update, and delete equipment items if they have the 'manager' role.",
        "Given a staff member, they can submit a loan request specifying a start date, end date, and equipment item.",
        "Given a manager, they can change the status of a loan request to either 'approved' or 'rejected'.",
        "Given a request is submitted for dates that overlap with an existing approved loan for the same item, the server rejects the request.",
        "Given a loan is past its end date and has not been returned, the UI highlights the loan as overdue.",
        "Given a manager is on the loans page, they can trigger a download of all loan records in CSV format.",
      ],
    ),
    expected: {
      kinds: {
        EquipmentItem: { kind: "business" },
        LoanRequest: { kind: "business" },
        EmailLog: { kind: "log" },
      },
      roles: { owner: "Manager", admin: "Manager", member: "Staff" },
      can: [
        ["member", "approve", false],
        ["admin", "approve", true],
        ["member", "export", false],
        ["admin", "export", true],
        ["member", "create", true],
      ],
      signUpEmailDomains: ["pixelyard.test"],
      timeZone: "UTC",
      patterns: ["workflow", "jobs.scheduled"],
    },
  },
  {
    id: "analytics-dashboard",
    prompt:
      'Build a sales analytics dashboard for "Brightside Coffee", a chain of six coffee shops. Visual identity: espresso brown `#3E2723`, cream `#FFF8E7`, caramel `#D4A373` charts. Managers upload daily sales as CSV (date, shop, product, quantity, revenue); invalid rows are rejected with a clear report and never half-imported. The dashboard shows revenue and units by day, week and month, top products, comparison between shops and versus the previous period, with filters by date range and shop; every chart can be exported as CSV. Shop managers see only their shop; the owner sees all.',
    recipeEntities: ["Dataset", "DataPoint", "Metric"],
    spec: base(
      "analytics-dashboard",
      "Brightside Coffee",
      "Sales analytics for a chain of six coffee shops with CSV import and comparisons.",
      ["owner", "shop_manager"],
      [
        {
          name: "DailySale",
          fields: [
            f("shopId", "reference"),
            f("date", "date"),
            f("productName", "string"),
            f("quantity", "integer"),
            f("revenue", "decimal"),
          ],
        },
        { name: "Shop", fields: [f("name", "string")] },
      ],
      [
        "Given a CSV upload with one invalid row, when the upload is processed, then the system rejects the entire file and provides a report containing the row number, field, and reason for the error.",
        "Given a dashboard view, when a user selects a date range or shop filter, then the revenue and units displayed update to reflect the selected criteria.",
        "Given a chart on the dashboard, when the export button is clicked, then a CSV file containing the chart's data is downloaded.",
        "Given a user logged in as a shop manager, when they attempt to view data for a different shop, then the system denies access and shows no data for that shop.",
        "Given a user logged in as an owner, when they access the dashboard, then they can view aggregated data for all six coffee shops.",
      ],
    ),
    expected: {
      kinds: { DailySale: { kind: "business" }, Shop: { kind: "business" } },
      roles: { owner: "Owner", admin: "Owner", member: "Shop manager" },
      can: [
        ["member", "read", true],
        ["owner", "delete", true],
      ],
      scope: { role: "member", kind: "own", of: "shop" },
      timeZone: "UTC",
      patterns: ["data.analytics-import", "membership-access"],
    },
  },
];

import type { BuildSpec } from "../build-spec.js";
import { extractBookingParams } from "../domains.js";
import type { Constraints } from "./constraints.js";
import type { EntityModel } from "./entity-kinds.js";
import type { PermissionMatrix } from "./permissions.js";
import { detectBlog, detectMatching, detectScreenRecording } from "./use-case-patterns.js";
import {
  listItems,
  mentions,
  nameWords,
  nounPattern,
  plural,
  sentences,
  singular,
} from "./text.js";

/**
 * Domain patterns (ADR-0042 §4): recurring shapes of business apps that a catalog component implements (status
 * workflows, membership access, audit log, private uploads, scheduled jobs, public pages, waitlist, analytics import,
 * kanban, bookings). Detection and parameters come from the request and from §1–§3 by code; a pattern is selected only
 * when an approved component in the catalog provides one of its capabilities (`PATTERN_CAPABILITIES`), otherwise it is
 * reported as detected-but-not-in-catalog and its criteria stay open.
 */
export type PatternId =
  | "workflow"
  | "membership-access"
  | "audit-log"
  | "private-uploads"
  | "jobs.scheduled"
  | "site.public-pages"
  | "growth.waitlist"
  | "data.analytics-import"
  | "kanban"
  | "bookings"
  | "social.connections"
  | "social.publish"
  | "social.metrics"
  | "blog"
  | "screen-recording"
  | "matching"
  | "reminders"
  | "messaging.sms"
  | "messaging.whatsapp";

/** Capabilities that implement each pattern, in order of preference (the component's `relations.provides`). */
export const PATTERN_CAPABILITIES: Record<PatternId, string[]> = {
  workflow: ["domain.workflow", "workflow"],
  "membership-access": ["authz.membership-access", "domain.membership-access", "membership-access"],
  "audit-log": ["domain.audit-log", "observability.audit-log", "audit-log"],
  "private-uploads": ["files.private-uploads", "private-uploads"],
  "jobs.scheduled": ["jobs.scheduled"],
  "site.public-pages": ["site.public-pages"],
  "growth.waitlist": ["growth.waitlist"],
  "data.analytics-import": ["data.analytics-import"],
  kanban: ["ui.kanban", "domain.kanban", "kanban"],
  bookings: ["domain.bookings"],
  "social.connections": ["social.oauth"],
  "social.publish": ["social.publish"],
  "social.metrics": ["social.metrics"],
  blog: ["content.blog"],
  "screen-recording": ["media.screen-recording"],
  matching: ["domain.matching"],
  reminders: ["domain.reminders"],
  "messaging.sms": ["messaging.sms"],
  "messaging.whatsapp": ["messaging.whatsapp"],
};

export interface PatternMatch {
  id: PatternId;
  params: Record<string, unknown>;
  /** Entities the component implements: no generic CRUD is generated for them. */
  providedEntities: string[];
  /** Sentences of the request that triggered the pattern. */
  evidence: string[];
  assumptions: string[];
}

export interface PatternInput {
  prompt: string;
  recipe: string;
  appName: string;
  spec: Pick<BuildSpec, "entities" | "acceptance_criteria">;
  entities: EntityModel[];
  permissions: PermissionMatrix;
  constraints: Constraints;
  /** Entities the recipe implements (possible subjects: Task, Project…). */
  knownEntities?: readonly string[];
}

const ROLE_ASSIGNMENT =
  /\brole[- ]based access( control)?\b|\brbac\b|\bassign\w*\b[^.;]{0,60}\broles?\b|\broles?\b[^.;]{0,40}\b(assign\w*|grant\w*)\b/i;

const JOB_STOPWORDS = new Set(
  "a an and are as at be by each every for from in is it of on or the their them then to was were with daily weekly nightly morning evening night hour week day".split(
    " ",
  ),
);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** The entity a noun phrase names ("document requests" → DocumentRequest), among `names`. */
function entityNamed(noun: string | null, names: readonly string[]): string | null {
  if (!noun) return null;
  const w = noun.toLowerCase().split(/\s+/).map(singular);
  return (
    names.find((n) => nameWords(n).join(" ") === w.join(" ")) ??
    names.find((n) => nameWords(n).at(-1) === w.at(-1)) ??
    null
  );
}

/** Every pattern the request describes, with its parameters (deterministic). */
export function detectPatterns(input: PatternInput): PatternMatch[] {
  const { prompt, constraints: c, permissions: perm } = input;
  const text = prompt.replace(/\s+/g, " ");
  const all = sentences(text);
  const business = input.entities.filter((e) => e.kind === "business").map((e) => e.name);
  const names = [
    ...new Set([...input.spec.entities.map((e) => e.name), ...(input.knownEntities ?? [])]),
  ];
  const out: PatternMatch[] = [];
  const said = (re: RegExp) => all.filter((s) => re.test(s));

  // Workflow: a stated status/stage list, or approve/reject decisions.
  const approval = said(
    /\bapprov\w*\b[^.;]{0,20}\b(or|and)\s+reject\w*|\breject\w*\b[^.;]{0,20}\b(or|and)\s+approv\w*/i,
  );
  const lists = c.statusLists.filter((l) => l.values.length >= 2);
  const workflows: {
    list: string[];
    field: string;
    of: string | null;
    source: string[];
    assumptions: string[];
  }[] = lists.map((l) => ({
    list: l.values,
    field: l.field,
    of: l.of,
    source: [l.source],
    assumptions: [],
  }));
  if (workflows.length === 0 && approval.length > 0) {
    const returned = /\breturn\w*|\bcheck(ed)?[- ]in\b/i.test(text);
    workflows.push({
      list: ["requested", "approved", "rejected", ...(returned ? ["returned"] : [])],
      field: "status",
      of: null,
      source: approval,
      assumptions: [
        `Statuses not listed: requested → approved | rejected${returned ? " → returned" : ""} (from "approves or rejects").`,
      ],
    });
  }
  for (const w of workflows) {
    const subject =
      entityNamed(w.of, names) ??
      input.spec.entities.find(
        (e) =>
          business.includes(e.name) &&
          e.fields.some((f) => new RegExp(`^(${w.field}|status|stage|state)$`, "i").test(f.name)),
      )?.name ??
      business.find((b) => w.source.some((s) => mentions(s, nameWords(b).slice(-1)))) ??
      business[0] ??
      null;
    if (!subject) continue;
    const history =
      input.entities.find((e) => e.kind === "event" && (e.parent === subject || !e.parent))?.name ??
      null;
    const approvers = perm.roles.filter((r) => r.actions.includes("approve")).map((r) => r.id);
    // A stated list is an ordered lifecycle (pending → received → approved); "approves or rejects" branches.
    const sequential = w.assumptions.length === 0;
    const transitions = sequential
      ? w.list.slice(1).map((to, i) => ({ from: w.list[i] as string, to, roles: approvers }))
      : w.list.slice(1).map((to) => ({ from: w.list[0] as string, to, roles: approvers }));
    if (!sequential && w.list.includes("returned") && w.list.includes("approved"))
      transitions.splice(
        transitions.findIndex((t) => t.to === "returned"),
        1,
        { from: "approved", to: "returned", roles: [] },
      );
    out.push({
      id: "workflow",
      params: {
        entity: subject,
        field: w.field,
        states: w.list,
        initial: w.list[0],
        transitions,
        history,
        immutableHistory: /\bcannot be edited|append-only|immutable|recorded and cannot\b/i.test(
          text,
        ),
        recordActor:
          /\b(the )?person\b|\bwho\b|\bby whom\b|\bstaff user\b|\bwith the date and the person\b/i.test(
            text,
          ),
      },
      providedEntities: history ? [history] : [],
      evidence: w.source,
      assumptions: [
        ...w.assumptions,
        ...(approvers.length === 0
          ? ["No role is named for status changes: owners and admins change them."]
          : []),
      ],
    });
  }

  // Membership access: per-record scopes ("only their own company", "projects they belong to") or invitations.
  const scoped = perm.roles.filter((r) => r.scope.kind !== "all");
  // Roles people assign to each other ("role-based access control", "assign admin, editor or viewer roles") are
  // managed members with roles too (ADR-0073): the owner assigns and changes them.
  const assignsRoles = ROLE_ASSIGNMENT.test(text);
  if (scoped.length > 0 || perm.invitations.enabled || assignsRoles) {
    const memberships = input.entities.filter((e) => e.shape === "membership");
    const scope = scoped[0]?.scope ?? { kind: "all" as const, of: "workspace" };
    const scopeEntity = entityNamed(scope.of, names);
    out.push({
      id: "membership-access",
      params: {
        scope: {
          kind: scope.kind === "all" ? "workspace" : scope.kind,
          entity: scopeEntity ?? scope.of,
        },
        scopedRoles: scoped.map((r) => r.id),
        roles: perm.roles.map((r) => ({ id: r.id, label: r.label, orgRoles: r.orgRoles })),
        invitations: perm.invitations,
      },
      providedEntities: memberships.map((m) => m.name),
      evidence: [
        ...said(/\binvit\w*/i),
        ...said(/\bonly(?: ever)? sees?\b|\bsees? only\b|\bbelong to\b/i),
        ...said(ROLE_ASSIGNMENT),
      ],
      assumptions:
        scopeEntity || scope.of === "workspace" || !scope.of
          ? []
          : [`Scope "${scope.of}" is not an entity of the spec: the component creates it.`],
    });
  }

  // Audit log: "audit log", "every change is recorded".
  const audit = said(
    /\baudit\b|\bevery change (?:is|gets|must be) (?:recorded|logged)|\bchange history\b|\bwho changed\b/i,
  );
  if (audit.length > 0) {
    const viewers = perm.roles.filter((r) => r.actions.includes("view_audit")).map((r) => r.id);
    out.push({
      id: "audit-log",
      params: {
        entities: business,
        visibleTo: viewers.length ? viewers : ["owner"],
        immutable: true,
        actions: ["create", "update", "delete"],
      },
      providedEntities: input.entities
        .filter((e) => e.kind === "log" && /audit|change|activity/i.test(e.name))
        .map((e) => e.name),
      evidence: audit,
      assumptions: viewers.length ? [] : ["Audit log viewers not stated: owners."],
    });
  }

  // Private uploads: files people upload (not a CSV import).
  const uploadSentences = said(/\bupload\w*|\battachments?\b/i).filter((s) => !/\bcsv\b/i.test(s));
  if (c.uploads && uploadSentences.length > 0) {
    const attachment = input.entities.find(
      (e) => e.shape === "child" && /attach|file|document|upload/i.test(e.name),
    );
    const parent =
      attachment?.parent ??
      business.find((b) => uploadSentences.some((s) => mentions(s, nameWords(b).slice(-1)))) ??
      null;
    out.push({
      id: "private-uploads",
      params: {
        maxBytes: c.uploads.maxBytes ?? 10 * 1024 * 1024,
        types: c.uploads.types.length
          ? c.uploads.types
          : ["application/pdf", "image/jpeg", "image/png"],
        extensions: c.uploads.extensions.length
          ? c.uploads.extensions
          : ["pdf", "jpg", "jpeg", "png"],
        attachTo: parent,
        private: true,
        downloadableBy: perm.roles.some((r) => r.scope.kind === "own")
          ? "owner-and-staff"
          : perm.roles.some((r) => r.scope.kind === "membership")
            ? "scope-members"
            : "workspace-members",
        notifyOnUpload: /\bemail\w*[^.;]{0,30}\bwhen\b[^.;]{0,30}\bupload/i.test(text),
      },
      providedEntities: input.entities
        .filter((e) => e.shape === "child" && /attach|file|upload/i.test(e.name))
        .map((e) => e.name),
      evidence: uploadSentences,
      assumptions: [
        ...(c.uploads.maxBytes === null ? ["Upload size limit not stated: 10 MB."] : []),
        ...(c.uploads.types.length === 0 ? ["Upload types not stated: PDF, JPEG and PNG."] : []),
      ],
    });
  }

  // Scheduled jobs: stated schedules, plus "overdue … emailed" (a daily job).
  const jobId = (what: string) =>
    /\boverdue\b/i.test(what)
      ? "overdue-reminders"
      : slug(
          what
            .split(/\s+/)
            .filter((w) => !JOB_STOPWORDS.has(w.toLowerCase()))
            .slice(0, 3)
            .join(" "),
        ) || "job";
  const jobs = c.schedules.map((s) => ({
    id: jobId(s.what),
    cron: s.cron,
    timeZone: s.timeZone,
    what: s.what,
  }));
  const overdue = said(
    /\boverdue\b[^.;]*\b(email\w*|notif\w*|remind\w*)|\b(email\w*|notif\w*|remind\w*)\b[^.;]*\boverdue\b/i,
  );
  const jobAssumptions: string[] = [];
  if (overdue.length > 0 && !jobs.some((j) => /overdue/i.test(j.what))) {
    jobs.push({
      id: "overdue-reminders",
      cron: "0 7 * * *",
      timeZone: c.timeZone.value,
      what: overdue[0] ?? "overdue reminders",
    });
    jobAssumptions.push("Overdue reminders: no time stated, daily at 07:00.");
  }
  if (jobs.length > 0) {
    out.push({
      id: "jobs.scheduled",
      params: {
        jobs: jobs.map((j) => ({ ...j, id: j.id.replace(/^-+|-+$/g, "") || "job" })),
        logWhenNoEmailProvider:
          /\blog (it|them|the email)\b|\blogged when no\b|\blog\b[^.]{0,30}no email provider/i.test(
            text,
          ),
      },
      providedEntities: [],
      evidence: [
        ...said(/\bevery (morning|night|day|week|hour)|\bdaily\b|\bweekly\b/i),
        ...overdue,
      ],
      assumptions: jobAssumptions,
    });
  }

  // Public pages: one page per record, portfolio and listing pages.
  // ADR-0064 (audit N-02): the public booking page of an appointment business is the booking domain's own page, never
  // a collection of public pages; outside a corporate site, an entity gets public pages only when a sentence of the
  // request asks for pages of that entity.
  const corporate = input.recipe === "corporate-site";
  const pageSentences = said(
    /\b(its|their) own page\b|\bpage (?:per|for each)\b|\bportfolio\b|\bcareers?\b|\bpublic (page|profile)s?\b/i,
  ).filter((s) => corporate || !/\b(book\w*|appointments?|reservations?|slots?)\b/i.test(s));
  if (pageSentences.length > 0 || corporate) {
    const pages = business
      .filter((b) => {
        const w = nameWords(b);
        return (
          pageSentences.some((s) => new RegExp(nounPattern(w.slice(-1)), "i").test(s)) ||
          (corporate && /position|job|project|service|team/i.test(b))
        );
      })
      .filter((b) => !/contact|request|message|submission|lead/i.test(b))
      .map((b) => {
        const n = nameWords(b);
        const filters = [
          ...text.matchAll(
            new RegExp(
              `${nounPattern(n.slice(-1))}[^.;]*?\\bfilters? by ([a-z]+(?:,? (?:and )?[a-z]+)*)`,
              "gi",
            ),
          ),
        ].flatMap((m) => listItems(m[1] ?? ""));
        const detail = pageSentences.some((s) =>
          new RegExp(
            `(page (per|for each) ${nounPattern(n.slice(-1))}|${nounPattern(n.slice(-1))}[^.;]*own page|page per (${nounPattern(n.slice(-1))}))`,
            "i",
          ).test(s),
        );
        return { entity: b, path: `/${plural(n.join("-"))}`, detail, filters };
      });
    if (pages.length > 0)
      out.push({
        id: "site.public-pages",
        params: { pages, seo: /\bseo|sitemap|open graph|metadata\b/i.test(text) },
        providedEntities: [],
        evidence: pageSentences,
        assumptions: [],
      });
  }

  // Waitlist mechanics.
  if (/\bwait-?list\b/i.test(text)) {
    const boost = c.numbers.find((n) => /^move up by/.test(n.what))?.value ?? null;
    out.push({
      id: "growth.waitlist",
      params: {
        doubleOptIn: /double opt-?in|confirmation link/i.test(text),
        showPosition: /\bposition\b/i.test(text),
        referral: {
          enabled: /\breferr\w*/i.test(text),
          boost: boost ?? (/\breferr\w*/i.test(text) ? 1 : 0),
        },
        ownerCanExport: /\bexport\b/i.test(text),
        ownerCanRemove: /\bremov\w*|\bdelet\w*/i.test(text),
      },
      providedEntities: input.spec.entities
        .filter((e) => /wait|signup|subscriber|referral|lead/i.test(e.name))
        .map((e) => e.name),
      evidence: said(/\bwait-?list\b|\breferr\w*|\bopt-?in\b|\bposition\b/i),
      assumptions:
        boost === null && /\breferr\w*/i.test(text)
          ? ["Referral boost not stated: one position."]
          : [],
    });
  }

  // Analytics import: CSV uploads validated all-or-nothing, aggregated on a dashboard.
  const importSentences = said(
    /\b(upload|import)\w*\b[^.;]*\bcsv\b|\bcsv\b[^.;]*\b(upload|import)\w*/i,
  );
  if (
    importSentences.length > 0 &&
    (input.recipe === "analytics-dashboard" || /\bdashboard|\bchart|\banalytics\b/i.test(text))
  ) {
    const cols = /\bcsv\b\s*\(([^)]+)\)/i.exec(text)?.[1];
    const periods = ["day", "week", "month", "quarter", "year"].filter((p) =>
      new RegExp(`\\b${p}\\b`, "i").test(text),
    );
    const target =
      business.find((b) =>
        input.spec.entities
          .find((e) => e.name === b)
          ?.fields.some((f) => ["decimal", "integer"].includes(f.type)),
      ) ?? null;
    out.push({
      id: "data.analytics-import",
      params: {
        entity: target,
        columns: cols ? listItems(cols).map((x) => x.toLowerCase()) : [],
        atomic: /\bnever half|all[- ]or[- ]nothing|whole file|entire file|rejected\b/i.test(text),
        errorReport: /\breport\b/i.test(text),
        periods,
        compareWithPreviousPeriod: /\bprevious period|period over period|vs\.? last\b/i.test(text),
        filters: [...text.matchAll(/\bfilters? by ([a-z ,]+?)(?:[;.]|$)/gi)].flatMap((m) =>
          listItems(m[1] ?? ""),
        ),
        exportCsv: /\bexport\w*[^.;]*\bcsv\b/i.test(text),
      },
      providedEntities: target ? [target] : [],
      evidence: importSentences,
      assumptions: cols ? [] : ["CSV columns not stated: the entity's fields."],
    });
  }

  // Kanban board.
  const board = said(
    /\bkanban\b|\bboard by (stage|status)\b|\bdrag[- ]and[- ]drop\b|\bboard\b[^.;]*\b(stages?|status(es)?|columns?)\b/i,
  );
  if (board.length > 0) {
    const wf = out.find((p) => p.id === "workflow");
    const entity =
      (wf?.params.entity as string | undefined) ??
      names.find((n) =>
        board.some(
          (s) =>
            new RegExp(`${nounPattern(nameWords(n).slice(-1))}`, "i").test(s) &&
            /task|card|piece|item|ticket|deal/i.test(n),
        ),
      ) ??
      names.find((n) => /task/i.test(n)) ??
      business[0] ??
      null;
    out.push({
      id: "kanban",
      params: {
        entity,
        field: (wf?.params.field as string | undefined) ?? "status",
        columns: (wf?.params.states as string[] | undefined) ?? ["todo", "in_progress", "done"],
        dragAndDrop: /\bdrag/i.test(text),
        groupBy: /\bper project\b/i.test(text) ? "project" : null,
        highlightOverdue: /\boverdue|longer than|limit/i.test(text),
      },
      providedEntities: [],
      evidence: board,
      assumptions: wf ? [] : ["Board columns not stated: todo, in_progress, done."],
    });
  }

  // Bookings (domain.bookings): recipe bookings and booking assistants.
  if (input.recipe === "bookings" || input.recipe === "ai-agents") {
    const b = extractBookingParams(prompt, input.appName);
    if (b) {
      const params = { ...b.params } as Record<string, unknown> & typeof b.params;
      const assumptions = [...b.assumptions];
      if (c.prices.length > 0 && b.params.services.every((s) => s.price === null)) {
        params.services = c.prices.map((p) => ({
          name: p.name,
          minutes: p.minutes ?? 30,
          price: p.price,
          currency: p.currency,
        }));
        const minutes = params.services.map((s) => s.minutes);
        const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
        params.slotMinutes = Math.max(5, minutes.reduce(gcd));
        const drop = new Set([
          "Prices not stated: none published.",
          "Appointment length not stated: 30 minutes.",
        ]);
        assumptions.splice(0, assumptions.length, ...assumptions.filter((a) => !drop.has(a)));
      }
      out.push({
        id: "bookings",
        params,
        providedEntities: [],
        evidence: said(/\bbook\w*|\bappointments?\b|\breservations?\b/i),
        assumptions,
      });
      out.push(...detectReminders(all, b.params.timeZone));
    }
  }
  out.push(...detectMessaging(all, out));
  out.push(...detectSocial(text, all));
  // Use cases added from real demand (ADR-0073): blog, screen + camera recording, matching against a profile.
  out.push(
    ...detectBlog(all, c),
    ...detectScreenRecording(text, all),
    ...detectMatching(text, all),
  );
  return out;
}

// ─── Reminders and messaging (ADR-0070) ─────────────────────────────────────────────────────────────────────────

/** "SMS", "text message(s)", "by text" — the channel, never the text of a page or a field. */
const SMS =
  /\bsms\b|\btext messages?\b|\btexting\b|\b(?:by|via|per) text\b|\btexts? (?:them|customers?|clients?|patients?|users?|people|guests?)\b/i;
const WHATSAPP = /\bwhats ?app\b/i;
const EMAIL = /\be-?mails?\b/i;
const REMINDER = /\bremind(?:er|ers|s|ed|ing)?\b/i;
/** "24 hours before", "the day before", "2 days in advance": when the reminder goes out. */
const BEFORE =
  /\b(\d{1,3}|one|two|three|twenty-?four|forty-?eight)\s*-?\s*(hours?|hrs?|h|days?)\s+(?:before|ahead|prior|in advance|earlier)\b|\b(?:the|a|one)\s+day\s+(?:before|ahead|prior|in advance)\b|\b(\d{1,3})\s*h\b/i;
/** Sending to people: a channel named as data ("phone number for SMS") or a link is not a message. */
const SENDS =
  /\b(send|sends|sent|notif\w*|remind\w*|alert\w*|message\w*|texting|texts?|confirm\w*|receiv\w*|get|gets|dispatch\w*|deliver\w*)\b/i;
const CONTENT_ONLY =
  /\b(click[- ]to[- ]chat|whats ?app (link|button|icon)|share (via|on) whats ?app|links? to)\b/i;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  twentyfour: 24,
  "twenty-four": 24,
  fortyeight: 48,
  "forty-eight": 48,
};

/** Hours before the appointment a reminder sentence states, or null. */
export function reminderHours(sentence: string): number | null {
  const m = BEFORE.exec(sentence);
  if (!m) return null;
  if (m[3]) return Number(m[3]);
  if (!m[1]) return 24;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (WORD_NUMBERS[m[1].toLowerCase()] ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^d/i.test(m[2] ?? "") ? n * 24 : n;
}

/** ISO country of the most common time zones (for phone numbers typed without a country code); null otherwise. */
export const ZONE_COUNTRY: Record<string, string> = {
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Lisbon": "PT",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Zurich": "CH",
  "Europe/Vienna": "AT",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Mexico_City": "MX",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Sao_Paulo": "BR",
  "Asia/Tokyo": "JP",
  "Asia/Singapore": "SG",
  "Australia/Sydney": "AU",
};

/**
 * Appointment reminders (domain.reminders) in a booking app: sentences that remind customers before their appointment
 * ("a WhatsApp reminder 24 hours before each appointment", "with reminders"). Hours and channels are the ones stated;
 * 24 hours and email when the request does not say. Overdue reminders are scheduled digests (jobs.scheduled), not these.
 */
export function detectReminders(all: readonly string[], timeZone: string): PatternMatch[] {
  const evidence = all.filter(
    (s) =>
      !/\boverdue\b/i.test(s) &&
      (REMINDER.test(s) || ((SMS.test(s) || WHATSAPP.test(s)) && BEFORE.test(s) && SENDS.test(s))),
  );
  if (evidence.length === 0) return [];
  const assumptions: string[] = [];
  const stated = evidence.map(reminderHours).find((h): h is number => h !== null);
  let hoursBefore = stated ?? 24;
  if (stated === undefined)
    assumptions.push("Reminder time not stated: 24 hours before each appointment.");
  if (hoursBefore > 168) {
    hoursBefore = 168;
    assumptions.push("Reminders go out at most 7 days (168 hours) before the appointment.");
  }
  const named = (re: RegExp) => evidence.some((s) => re.test(s) && !CONTENT_ONLY.test(s));
  const channels = [
    ...(named(EMAIL) ? ["email"] : []),
    ...(named(SMS) ? ["sms"] : []),
    ...(named(WHATSAPP) ? ["whatsapp"] : []),
  ];
  if (channels.length === 0) {
    channels.push("email");
    assumptions.push("Reminder channel not stated: email.");
  }
  if (channels.some((c) => c !== "email"))
    assumptions.push(
      "SMS and WhatsApp reminders go only to people who tick that box on the booking form and give a mobile number; a STOP reply stops them.",
    );
  if (channels.includes("whatsapp"))
    assumptions.push(
      'WhatsApp reminders use the template "appointment_reminder" (en) with four parameters, to be approved in WhatsApp Manager.',
    );
  const country = ZONE_COUNTRY[timeZone] ?? null;
  const out: PatternMatch[] = [
    {
      id: "reminders",
      params: {
        hoursBefore,
        channels,
        whatsappTemplate: { name: "appointment_reminder", language: "en" },
        maxAttempts: 3,
      },
      providedEntities: [],
      evidence,
      assumptions,
    },
  ];
  // The channels' components, with the country of the booking time zone for numbers typed without a country code.
  for (const [id, channel] of [
    ["messaging.sms", "sms"],
    ["messaging.whatsapp", "whatsapp"],
  ] as const) {
    if (!channels.includes(channel)) continue;
    out.push({
      id,
      params: { defaultCountry: country, maxAttempts: 3 },
      providedEntities: [],
      evidence: evidence.filter((s) => (channel === "sms" ? SMS : WHATSAPP).test(s)),
      assumptions: [
        country
          ? `Phone numbers typed without a country code are read as ${country} numbers (time zone ${timeZone}).`
          : "Phone numbers must be typed with their country code (+…): no default country.",
      ],
    });
  }
  return out;
}

/**
 * The reminder and messaging patterns of a request, from its words alone (no spec needed): what the scope gate and
 * the plan use before the fidelity wiring runs, and the same detection the wiring uses afterwards.
 */
export function messagingPatterns(
  prompt: string,
  recipe: string,
  appName?: string,
): PatternMatch[] {
  const all = sentences(prompt.replace(/\s+/g, " "));
  const found: PatternMatch[] = [];
  if (recipe === "bookings" || recipe === "ai-agents") {
    const b = extractBookingParams(prompt, appName);
    if (b) found.push(...detectReminders(all, b.params.timeZone));
  }
  return [...found, ...detectMessaging(all, found)];
}

/**
 * Messaging channels (messaging.sms / messaging.whatsapp): a sentence that sends SMS or WhatsApp messages to people, or
 * reminders on those channels. A channel named as data or a link (a "WhatsApp button", "click to chat") selects nothing.
 * Keeps the parameters reminders already set (the default country from the booking time zone).
 */
export function detectMessaging(
  all: readonly string[],
  found: readonly PatternMatch[] = [],
): PatternMatch[] {
  const reminder = found.find((p) => p.id === "reminders");
  const reminderChannels = (reminder?.params.channels as string[] | undefined) ?? [];
  const out: PatternMatch[] = [];
  for (const [id, re, channel] of [
    ["messaging.sms", SMS, "sms"],
    ["messaging.whatsapp", WHATSAPP, "whatsapp"],
  ] as const) {
    if (found.some((p) => p.id === id)) continue;
    const evidence = all.filter((s) => re.test(s) && SENDS.test(s) && !CONTENT_ONLY.test(s));
    if (evidence.length === 0 && !reminderChannels.includes(channel)) continue;
    out.push({
      id,
      params: { defaultCountry: null, maxAttempts: 3 },
      providedEntities: [],
      evidence,
      assumptions: [
        "Phone numbers must be typed with their country code (+…): no default country.",
      ],
    });
  }
  return out;
}

/** Social networks a request names, when it acts on them (publish, schedule, connect, measure). */
export const SOCIAL_NETWORKS: Record<"linkedin" | "facebook" | "instagram" | "x", RegExp> = {
  linkedin: /\blinked ?in\b/i,
  facebook: /\bfacebook\b|\bfb pages?\b/i,
  instagram: /\binstagram\b|\binsta\b/i,
  // "X" only where it names the network: "Twitter", "tweets", "X (Twitter)", "X accounts", "… and X".
  x: /\btwitter\b|\btweets?\b|\bx\.com\b|\bx\s*\(twitter\)|\bx\s+(?:accounts?|posts?|profiles?)\b|(?:,|\band|\bor)\s+x\b(?![-.\w])/i,
};
const SOCIAL_ANY = /\bsocial[- ](?:media|networks?|accounts?|channels?|platforms?|posts?)\b/i;
const SOCIAL_ACTION =
  /\b(publish|post|schedul|share|connect|integrat|auto-?post|cross-?post|tweet|link (?:their|your|the) |authori[sz])\w*/i;
/** Share buttons, profile links and handles are plain web content, not an integration. */
const SOCIAL_CONTENT_ONLY =
  /\b(share buttons?|links? to|profile links?|icons?|handles?|usernames?|follow us)\b/i;
const SOCIAL_METRICS =
  /\b(engagement|metrics?|likes|impressions|reach|insights|analytics|performance)\b/i;

/**
 * Social publishing (social.connections / social.publish / social.metrics): sentences that connect, publish to or
 * measure LinkedIn, Facebook, Instagram or X. Networks are the ones named (all four when it only says "social media").
 * Approval is on unless the request says posts go out without it.
 */
export function detectSocial(
  text: string,
  all: readonly string[] = sentences(text),
): PatternMatch[] {
  const named = (s: string) =>
    (Object.keys(SOCIAL_NETWORKS) as (keyof typeof SOCIAL_NETWORKS)[]).filter((n) =>
      SOCIAL_NETWORKS[n].test(s),
    );
  const social = all.filter(
    (s) =>
      (named(s).length > 0 || SOCIAL_ANY.test(s)) &&
      SOCIAL_ACTION.test(s) &&
      !SOCIAL_CONTENT_ONLY.test(s),
  );
  if (social.length === 0) return [];
  const networks = [...new Set(social.flatMap(named))];
  const assumptions: string[] = [];
  if (networks.length === 0) {
    networks.push("linkedin", "facebook", "instagram", "x");
    assumptions.push("Social networks not named: LinkedIn, Facebook, Instagram and X.");
  }
  const providers = [
    ...new Set(networks.map((n) => (n === "facebook" || n === "instagram" ? "meta" : n))),
  ];
  const out: PatternMatch[] = [
    {
      id: "social.connections",
      params: { providers },
      providedEntities: [],
      evidence: social,
      assumptions,
    },
  ];
  const publishes = social.filter((s) =>
    /\b(publish|post|schedul|share|auto-?post|cross-?post|tweet)\w*/i.test(s),
  );
  if (publishes.length > 0) {
    const noApproval = /\b(without|no) (?:human |manual )?(?:approval|review)\b/i.test(text);
    out.push({
      id: "social.publish",
      params: { networks, requireApproval: !noApproval, maxAttempts: 5 },
      providedEntities: [],
      evidence: publishes,
      assumptions: /\bapprov|\breview/i.test(text)
        ? []
        : [
            "Approval not stated: posts are approved by someone who may approve before they are scheduled.",
          ],
    });
    const measured = all.filter(
      (s) =>
        SOCIAL_METRICS.test(s) &&
        (named(s).length > 0 || SOCIAL_ANY.test(s) || /\bposts?\b/i.test(s)),
    );
    if (measured.length > 0)
      out.push({
        id: "social.metrics",
        params: { refreshHours: 6, windowDays: 30 },
        providedEntities: [],
        evidence: measured,
        assumptions: ["Metrics refreshed every 6 hours for posts of the last 30 days."],
      });
  }
  return out;
}

/** The criterion mentions the pattern's subject (used by the report to explain open criteria). */
export function criterionTouches(criterion: string, p: PatternMatch): boolean {
  const words: Record<PatternId, RegExp> = {
    workflow: /\bstatus|\bstage|\bapprov|\breject|\btransition|\badvance/i,
    "membership-access":
      /\binvit|\bonly (access|see|view)|\bbelong|\bassigned|\bown (company|shop|project)|\bdifferent shop|\bnot assigned/i,
    "audit-log": /\baudit|\brecorded|\bappend-only|\bhistory/i,
    "private-uploads": /\bupload|\battachment|\bfile|\bdownload/i,
    "jobs.scheduled": /\bjob|\bevery morning|\bdaily|\boverdue.*email|\bcron|\bschedul/i,
    "site.public-pages": /\bpage|\bportfolio|\bcareers|\bseo|\bsitemap/i,
    "growth.waitlist": /\bwaitlist|\breferr|\bopt-in|\bposition/i,
    "data.analytics-import": /\bcsv|\bimport|\bupload|\bchart|\brevenue/i,
    kanban: /\bkanban|\bboard|\bdrag/i,
    bookings: /\bbook|\bslot|\bstylist|\bappointment|\bcancel/i,
    "social.connections":
      /\bconnect|\blinked ?in|\bfacebook|\binstagram|\btwitter|\bsocial|\boauth/i,
    "social.publish": /\bpublish|\bpost|\bschedul|\bapprov|\bretr|\bcalendar|\bformat|\blength/i,
    "social.metrics": /\bmetric|\bengagement|\blikes|\bimpression|\banalytics/i,
    blog: /\bblog|\bpost|\barticle|\brss|\bfeed|\btag|\bauthor|\bdraft|\breading time/i,
    "screen-recording":
      /\brecord|\bscreen|\bcamera|\bwebcam|\blayout|\b4k|\bresolution|\bvideo|\bshare/i,
    matching:
      /\bmatch|\binterest|\bprofile|\bsector|\bregion|\bterritor|\bkeyword|\brelevan|\bopportunit/i,
    reminders: /\bremind|\bbefore (the|their|each) (appointment|booking|session)|\bhours? before/i,
    "messaging.sms": /\bsms\b|\btext message|\bstop\b|\bopt[- ]?out/i,
    "messaging.whatsapp": /\bwhats ?app|\btemplate/i,
  };
  return words[p.id].test(criterion);
}

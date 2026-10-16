import type { BuildSpec } from "../build-spec.js";
import { extractBookingParams } from "../domains.js";
import type { Constraints } from "./constraints.js";
import type { EntityModel } from "./entity-kinds.js";
import type { PermissionMatrix } from "./permissions.js";
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
  | "social.metrics";

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
  if (scoped.length > 0 || perm.invitations.enabled) {
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
    }
  }
  out.push(...detectSocial(text, all));
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
  };
  return words[p.id].test(criterion);
}

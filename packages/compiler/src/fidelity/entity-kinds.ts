import { choice, type Decider } from "@turbineh/decider";
import type { BuildSpec } from "../build-spec.js";
import { mentions, nameWords, nounPattern, plural, sentences, singular } from "./text.js";

/**
 * Entity modelling (ADR-0042 §1). The compiler model lists "entities"; not every noun deserves a CRUD page. Each one is
 * classified by code into one of five kinds, and the assembler generates the matching UI:
 *
 * | kind           | what it is                                        | UI                                              |
 * | -------------- | ------------------------------------------------- | ----------------------------------------------- |
 * | business       | records people create and work on                 | CRUD (or a workflow screen of a component)      |
 * | relationship   | tags, joins, memberships, owned child collections | none of its own: managed from the parent        |
 * | event          | history of changes, append-only                   | timeline on the parent, never edited or deleted |
 * | configuration  | limits, thresholds, settings                      | a settings page (no list of records to delete)  |
 * | log            | technical records (emails sent, deliveries)       | none, unless the request asks to show it        |
 *
 * Deterministic first; only entities the rules mark `unsure` go to the decider (one Choice each, one batched request),
 * accepted at `ENTITY_KIND_CONFIDENCE`; below it the code's default stands.
 */
export type EntityKind = "business" | "relationship" | "event" | "configuration" | "log";
export type RelationshipShape = "tags" | "join" | "membership" | "child";
export type EntityUi = "crud" | "parent" | "timeline" | "settings" | "none";

export interface EntityModel {
  name: string;
  kind: EntityKind;
  /** Relationships only: how it relates to its parent. */
  shape?: RelationshipShape;
  /** The entity that owns it (relationships, events, child configuration), or null when none applies. */
  parent: string | null;
  ui: EntityUi;
  /** The rule (or decider answer) that decided, for AGENTS.md and the fidelity report. */
  reason: string;
  decidedBy: "code" | "decider";
  /** True when the rules were not conclusive (the decider is asked when available). */
  unsure: boolean;
  /** Decider confidence when it was asked. */
  confidence?: number;
}

type Entity = BuildSpec["entities"][number];
type Field = Entity["fields"][number];

/** Calibration v1 (2026-10-13, `bench/fidelity/entity-kinds.ts`): a decider answer below this keeps the code default. */
export const ENTITY_KIND_CONFIDENCE = 0.7;

const LOG_SUBJECTS = new Set([
  "email",
  "mail",
  "notification",
  "sms",
  "delivery",
  "outbox",
  "webhook",
  "sent",
  "send",
  "message",
  "import",
  "sync",
]);
const EVENT_HEADS = new Set([
  "event",
  "history",
  "transition",
  "change",
  "movement",
  "revision",
  "timeline",
]);
const CONFIG_HEADS = new Set([
  "limit",
  "setting",
  "settings",
  "config",
  "configuration",
  "preference",
  "threshold",
  "policy",
  "quota",
  "option",
]);
const CONFIG_PHRASES = ["opening hour", "business hour", "working hour", "opening time"];
const TAG_HEADS = new Set(["tag", "label", "keyword"]);
const MEMBERSHIP_HEADS = new Set(["member", "membership", "participant", "teammate"]);
const CHILD_HEADS = new Set([
  "comment",
  "message",
  "reply",
  "attachment",
  "file",
  "photo",
  "image",
  "phase",
  "step",
  "line",
  "checklist",
]);
const USER_REFS = new Set([
  "user",
  "owner",
  "author",
  "assignee",
  "creator",
  "uploader",
  "sender",
  "staff",
  "actor",
  "by",
  "member",
  "manager",
]);
/** Workspace-level scopes provided by authentication (better-auth organizations: members, invitations, roles). */
const WORKSPACE_SCOPES = new Set(["workspace", "organization", "organisation", "team", "tenant"]);
/** Ambiguous heads: the rules default to business but ask the decider. */
const AMBIGUOUS_HEADS = new Set(["entry", "record", "snapshot", "assignment", "link", "item"]);

const head = (name: string) => singular(nameWords(name).at(-1) ?? "");

/** The entity a field references (by name: "taskId", "documentRequest", "piece_id"), among `names`. */
export function referencedEntity(f: Field, names: readonly string[]): string | null {
  if (!["reference", "string", "integer"].includes(f.type)) return null;
  const w = nameWords(f.name);
  const stem = (w.at(-1) === "id" || w.at(-1) === "ids" ? w.slice(0, -1) : w).join(" ");
  if (!stem || (f.type !== "reference" && w.at(-1) !== "id")) return null;
  return (
    names.find((n) => {
      const nw = nameWords(n).join(" ");
      return nw === stem || plural(nw) === stem || nw === singular(stem);
    }) ?? null
  );
}

/** A field pointing at a person (assignee, uploadedBy, userId, changedBy…). */
function isUserRef(f: Field): boolean {
  const w = nameWords(f.name).filter((x) => x !== "id");
  return w.some((x) => USER_REFS.has(singular(x)));
}

/** Parent named by the entity's own prefix ("ProjectMembership" → Project, "NoteTag" → Note). */
function prefixParent(name: string, names: readonly string[]): string | null {
  const w = nameWords(name);
  for (let i = w.length - 1; i >= 1; i--) {
    const prefix = w.slice(0, i).join(" ");
    const hit = names.find((n) => n !== name && nameWords(n).join(" ") === prefix);
    if (hit) return hit;
  }
  return null;
}

/** "Projects have phases", "each task has comments", "messages … per request" → the parent of `child`. */
function promptParent(child: string, names: readonly string[], prompt: string): string | null {
  const cw = nameWords(child);
  const childRe = nounPattern(cw.length > 1 ? cw.slice(-1) : cw);
  for (const s of sentences(prompt)) {
    if (!new RegExp(childRe, "i").test(s)) continue;
    for (const n of names) {
      if (n === child) continue;
      const nw = nameWords(n);
      for (const words of [nw, nw.slice(-1)]) {
        const p = nounPattern(words);
        const has = new RegExp(
          `${p}\\s*(?:\\([^)]*\\))?\\s+(?:have|has|with|contains?|holds?)\\b[^.;]*?${childRe}`,
          "i",
        );
        const per = new RegExp(
          `${childRe}[^.;]*?\\b(?:per|for each|of each|on each|of the)\\s+${p}`,
          "i",
        );
        if (has.test(s) || per.test(s)) return n;
      }
    }
  }
  return null;
}

export interface ClassifyContext {
  /** Entities the recipe or a component already implements (they can still be parents: "Task", "Project"). */
  knownEntities?: readonly string[];
}

/** Classifies every entity of the spec (deterministic). */
export function classifyEntities(
  spec: Pick<BuildSpec, "entities">,
  prompt: string,
  ctx: ClassifyContext = {},
): EntityModel[] {
  const own = spec.entities.map((e) => e.name);
  const names = [...new Set([...own, ...(ctx.knownEntities ?? [])])];
  const models = spec.entities.map((e) => classifyOne(e, names, prompt, spec.entities));
  // A join of a tag entity with its parent is part of the parent's tags field, like the tag entity itself.
  return models.map((m) => {
    if (m.shape !== "join") return m;
    const sides = joinSides(m.name, names);
    const tag = sides.find((s) => models.find((x) => x.name === s)?.shape === "tags");
    if (!tag) return m;
    const parent = sides.find((s) => s !== tag) ?? m.parent;
    return {
      ...m,
      shape: "tags",
      parent,
      reason: `join of ${parent} and ${tag}: part of the tags field`,
    };
  });
}

/** "NoteTag" → ["Note", "Tag"] when both are entities. */
function joinSides(name: string, names: readonly string[]): string[] {
  const w = nameWords(name);
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(" ");
    const b = w.slice(i).join(" ");
    const left = names.find((n) => n !== name && nameWords(n).join(" ") === a);
    const right = names.find(
      (n) => n !== name && [b, singular(b)].includes(nameWords(n).join(" ")),
    );
    if (left && right) return [left, right];
  }
  return [];
}

function classifyOne(
  e: Entity,
  names: readonly string[],
  prompt: string,
  all: readonly Entity[],
): EntityModel {
  const w = nameWords(e.name);
  const h = head(e.name);
  const phrase = w.join(" ");
  const others = names.filter((n) => n !== e.name);
  const refs = e.fields
    .map((f) => ({ f, to: referencedEntity(f, others) }))
    .filter((r): r is { f: Field; to: string } => r.to !== null);
  const userRefs = e.fields.filter((f) => !referencedEntity(f, others) && isUserRef(f));
  const plain = e.fields.filter(
    (f) =>
      !referencedEntity(f, others) &&
      !isUserRef(f) &&
      !/^(created|updated)(at|on)?$|^(order|position|sort|role)$/i.test(f.name),
  );
  const base = { name: e.name, decidedBy: "code" as const, unsure: false };
  const parentOf = () =>
    refs[0]?.to ?? prefixParent(e.name, others) ?? promptParent(e.name, others, prompt);

  // 1 · Logs: technical records of something the app did (emails sent, deliveries, imports).
  if (h === "log" && w.slice(0, -1).some((x) => LOG_SUBJECTS.has(singular(x)))) {
    const shown = new RegExp(
      `${nounPattern(w)}[^.;]*\\b(visible|shown|show|view|see|page|screen|list)\\b`,
      "i",
    ).test(prompt);
    return {
      ...base,
      kind: "log",
      parent: null,
      ui: shown ? "crud" : "none",
      reason: shown
        ? `technical log the request asks to show ("${phrase}")`
        : `technical log ("${phrase}"): no UI, the component that writes it records it`,
    };
  }
  // 2 · Events: history of changes, append-only, shown on the parent's timeline.
  const changeFields = e.fields.filter((f) =>
    /^(from|to|previous|prev|old|new|next)[A-Z]|^(changed|moved|transitioned)(At|By|On)$/.test(
      f.name,
    ),
  );
  if (EVENT_HEADS.has(h) || (refs.length >= 1 && changeFields.length >= 2)) {
    return {
      ...base,
      kind: "event",
      parent: parentOf(),
      ui: "timeline",
      reason: EVENT_HEADS.has(h)
        ? `history noun "${h}": append-only, shown on the parent's timeline`
        : "records a change (from/to fields): append-only, shown on the parent's timeline",
    };
  }
  // 3 · Configuration: limits, thresholds, settings → a settings page.
  if (CONFIG_HEADS.has(h) || CONFIG_PHRASES.some((p) => phrase.includes(p))) {
    return {
      ...base,
      kind: "configuration",
      parent: prefixParent(e.name, others),
      ui: "settings",
      reason: `configuration noun "${h}": a settings page, not CRUD`,
    };
  }
  // 4 · Relationships: managed from the parent, never a page of their own.
  if (TAG_HEADS.has(h)) {
    const parent =
      others.find(
        (n) => joinSides(`${n}${e.name}`, names).length === 2 && names.includes(`${n}${e.name}`),
      ) ??
      all.find((x) => x.name !== e.name && x.fields.some((f) => /^tags?(Ids?)?$/i.test(f.name)))
        ?.name ??
      promptParent(e.name, others, prompt) ??
      null;
    return {
      ...base,
      kind: "relationship",
      shape: "tags",
      parent,
      ui: "parent",
      reason: `tags: a multi-value field${parent ? ` of ${parent}` : ""} with a filter, not an entity`,
    };
  }
  const sides = joinSides(e.name, names);
  if (sides.length === 2 && plain.length <= 1) {
    return {
      ...base,
      kind: "relationship",
      shape: "join",
      parent: sides[0] ?? null,
      ui: "parent",
      reason: `join of ${sides.join(" and ")}: managed from ${sides[0]}`,
    };
  }
  const scopePrefix = w.slice(0, -1).join(" ");
  // A member with a profile (name, photo, bio) is a business record ("TeamMember" on a corporate site).
  const membershipFields = plain.every((f) => /email|status|invit|join|accept|since/i.test(f.name));
  if (
    (MEMBERSHIP_HEADS.has(h) && (refs.length + userRefs.length > 0 || membershipFields)) ||
    (userRefs.length >= 1 && refs.length === 1 && plain.length === 0)
  ) {
    const workspace = WORKSPACE_SCOPES.has(scopePrefix) || (w.length === 1 && h === "member");
    const parent = workspace ? null : (refs[0]?.to ?? prefixParent(e.name, others));
    return {
      ...base,
      kind: "relationship",
      shape: "membership",
      parent,
      ui: "parent",
      reason: workspace
        ? "workspace membership: invitations with roles (authentication provides members)"
        : `membership of ${parent ?? "a parent"}: who belongs to it, managed from it`,
    };
  }
  if (refs.length >= 2 && plain.length === 0) {
    return {
      ...base,
      kind: "relationship",
      shape: "join",
      parent: refs[0]?.to ?? null,
      ui: "parent",
      reason: `links ${refs.map((r) => r.to).join(" and ")}: managed from ${refs[0]?.to}`,
    };
  }
  const saidParent = promptParent(e.name, others, prompt);
  if (CHILD_HEADS.has(h) && (refs.length >= 1 || saidParent)) {
    const parent = saidParent ?? refs[0]?.to ?? null;
    return {
      ...base,
      kind: "relationship",
      shape: "child",
      parent,
      ui: "parent",
      reason: `${plural(h)} of ${parent}: listed and added on the ${parent} page`,
    };
  }
  // 5 · Business entities. Unsure when the shape says "link" but the name does not, or the head is ambiguous.
  const unsure = AMBIGUOUS_HEADS.has(h) || (refs.length >= 2 && plain.length <= 1);
  return {
    ...base,
    kind: "business",
    parent: null,
    ui: "crud",
    unsure,
    reason: unsure
      ? "no rule is conclusive: business by default"
      : "records people create and work on",
  };
}

const KIND_OPTIONS: Record<EntityKind, string> = {
  business: "records people create, list, edit and work on (their own page)",
  relationship:
    "a tag, a link between two records, a membership or a child list managed from its parent",
  event: "an append-only history of changes to another record",
  configuration: "settings, limits or thresholds that configure the app",
  log: "a technical record of something the app did (emails sent, deliveries)",
};

/**
 * Asks the decider about the entities the rules were unsure of (one batched request, one Choice each). Answers below
 * `ENTITY_KIND_CONFIDENCE`, unknown answers and decider errors keep the code's classification.
 */
export async function decideUnsureKinds(
  models: EntityModel[],
  spec: Pick<BuildSpec, "entities">,
  prompt: string,
  decider: Decider | null | undefined,
): Promise<{ models: EntityModel[]; asked: number; latencyMs: number }> {
  const unsure = models.filter((m) => m.unsure);
  if (!decider || unsure.length === 0) return { models, asked: 0, latencyMs: 0 };
  const questions = Object.fromEntries(
    unsure.map((m, i) => [
      `kind_${i}`,
      choice(
        `In the app described in \`prompt\`, what is the data entity \`entities.${m.name}\`?`,
        KIND_OPTIONS,
        { includeNone: false },
      ),
    ]),
  );
  const state = {
    prompt,
    entities: Object.fromEntries(
      spec.entities.map((e) => [e.name, e.fields.map((f) => `${f.name}: ${f.type}`).join(", ")]),
    ),
  };
  try {
    const d = await decider.ask(state, questions);
    const byName = new Map<string, EntityModel>();
    unsure.forEach((m, i) => {
      const a = d.answers[`kind_${i}`];
      if (a?.type !== "choice" || a.confidence < ENTITY_KIND_CONFIDENCE) return;
      const kind = a.choice as EntityKind;
      if (!(kind in KIND_OPTIONS)) return;
      byName.set(m.name, {
        ...m,
        kind,
        ui: {
          business: "crud",
          relationship: "parent",
          event: "timeline",
          configuration: "settings",
          log: "none",
        }[kind] as EntityUi,
        decidedBy: "decider",
        confidence: a.confidence,
        reason: `decider: ${KIND_OPTIONS[kind]} (confidence ${a.confidence.toFixed(2)})`,
      });
    });
    return {
      models: models.map((m) => byName.get(m.name) ?? m),
      asked: unsure.length,
      latencyMs: d.meta.latencyMs,
    };
  } catch {
    return { models, asked: unsure.length, latencyMs: 0 };
  }
}

/**
 * Applies the modelling to the spec: tag entities and their joins become one `tags` field of the parent (a
 * multi-value field with a filter). Every other kind stays in the spec; the assembler generates its UI by kind.
 */
export function applyEntityModel(spec: BuildSpec, models: readonly EntityModel[]): BuildSpec {
  const absorbed = new Set(models.filter((m) => m.shape === "tags").map((m) => m.name));
  const tagParents = new Set(
    models.filter((m) => m.shape === "tags" && m.parent).map((m) => m.parent as string),
  );
  const refs = new Set([...absorbed].map((n) => nameWords(n).join("")));
  const isTagField = (f: Field) => /^(tags?|labels|keywords)(Ids?)?$/i.test(f.name);
  const entities = spec.entities
    .filter((e) => !absorbed.has(e.name))
    .map((e) => {
      const fields = e.fields.filter((f) => {
        const w = nameWords(f.name)
          .filter((x) => x !== "id" && x !== "ids")
          .join("");
        return !refs.has(w) && !refs.has(singular(w)) && !isTagField(f);
      });
      const wantsTags = tagParents.has(e.name) || fields.length !== e.fields.length;
      if (!wantsTags) return e;
      const at = e.fields.findIndex((f) => isTagField(f) || refs.has(nameWords(f.name).join("")));
      const tags = { name: "tags", type: "tags" as const, required: false };
      const next = [...fields];
      next.splice(at >= 0 ? Math.min(at, next.length) : next.length, 0, tags);
      return { ...e, fields: next };
    })
    .filter((e) => e.fields.length > 0);
  const changed =
    absorbed.size > 0 ||
    entities.some((e, i) => e !== spec.entities.filter((x) => !absorbed.has(x.name))[i]);
  return changed ? { ...spec, entities } : spec;
}

/** True when the request mentions the entity by name (used by the report to show what came from where). */
export const statedInPrompt = (name: string, prompt: string) => mentions(prompt, nameWords(name));

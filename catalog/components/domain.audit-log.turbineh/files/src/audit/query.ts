import { and, count, desc, eq, gte, ilike, lt, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents } from "@/db/schema";

/**
 * Reading the audit log (component domain.audit-log.turbineh): always one workspace, newest first, with filters by
 * actor, action, subject type and date range. Read-only.
 */
export interface AuditFilters {
  actor: string;
  action: string;
  subject: string;
  /** YYYY-MM-DD (inclusive), UTC. */
  from: string;
  /** YYYY-MM-DD (inclusive), UTC. */
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filters from the query string: bounded, dates only when well-formed. */
export function parseFilters(q: Record<string, string | string[] | undefined>): AuditFilters {
  const day = (v: string) => (DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");
  return {
    actor: one(q.actor).trim().slice(0, 120),
    action: one(q.action).trim().slice(0, 80),
    subject: one(q.subject).trim().slice(0, 80),
    from: day(one(q.from).trim()),
    to: day(one(q.to).trim()),
  };
}

function where(organizationId: string, f: AuditFilters): SQL | undefined {
  const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000);
  return and(
    eq(auditEvents.organizationId, organizationId),
    f.actor ? ilike(auditEvents.actorEmail, `%${f.actor.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    f.action ? eq(auditEvents.action, f.action) : undefined,
    f.subject ? eq(auditEvents.subjectType, f.subject) : undefined,
    f.from ? gte(auditEvents.createdAt, new Date(`${f.from}T00:00:00Z`)) : undefined,
    f.to ? lt(auditEvents.createdAt, next(f.to)) : undefined,
  );
}

export async function listAuditEvents(
  organizationId: string,
  f: AuditFilters,
  page: { limit: number; offset: number },
) {
  const filter = where(organizationId, f);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(auditEvents)
      .where(filter)
      .orderBy(desc(auditEvents.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ n: count() }).from(auditEvents).where(filter),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** Distinct actions and subject types of the workspace, for the filter menus. */
export async function auditFacets(organizationId: string) {
  const [actions, subjects] = await Promise.all([
    db
      .selectDistinct({ v: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(auditEvents.action)
      .limit(200),
    db
      .selectDistinct({ v: auditEvents.subjectType })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(auditEvents.subjectType)
      .limit(200),
  ]);
  return { actions: actions.map((r) => r.v), subjects: subjects.map((r) => r.v) };
}

export async function exportAuditEvents(organizationId: string, f: AuditFilters, limit: number) {
  return db
    .select()
    .from(auditEvents)
    .where(where(organizationId, f))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

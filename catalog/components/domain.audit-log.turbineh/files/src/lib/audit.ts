import { db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { auditConfig } from "@/audit/config";
import { defaultSummary, diffChanges } from "@/audit/diff";

/**
 * Audit hook (ADR-0040), implemented by domain.audit-log.turbineh: every change made through generated entities and
 * domain components is appended to `audit_events` — who, when, what and which fields changed (sensitive values
 * redacted). Append-only: there is no update or delete anywhere, and the database refuses them.
 */
export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  actorEmail?: string | null;
  /** e.g. "note.created", "invitation.accepted", "request.status_changed". */
  action: string;
  subjectType: string;
  subjectId?: string | null;
  /** One line a person can read. */
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Appends one entry. Fails loudly (an unrecorded change is a bug, not a detail). */
export async function audit(entry: AuditEntry): Promise<void> {
  const changes = diffChanges(entry.before, entry.after, {
    redact: auditConfig.redactFields,
    ignore: auditConfig.ignoreFields,
  });
  await db.insert(auditEvents).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    actorEmail: entry.actorEmail?.toLowerCase() ?? null,
    action: entry.action.slice(0, 80),
    subjectType: entry.subjectType.slice(0, 80),
    subjectId: entry.subjectId ?? null,
    summary: (entry.summary ?? defaultSummary(entry.action, changes)).slice(0, 500),
    changes,
  });
}

/**
 * Audit hook (ADR-0040). Every change made through generated entities and domain components calls `audit()`. In the
 * base template it does nothing; the component domain.audit-log.turbineh replaces this file with an append-only log
 * (who, when, what changed) and an owner-visible page.
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

export async function audit(entry: AuditEntry): Promise<void> {
  void entry;
}

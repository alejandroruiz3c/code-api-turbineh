/**
 * What changed between two versions of a record (component domain.audit-log.turbineh). Pure and unit-tested: values
 * are rendered as short strings, sensitive fields are redacted (never stored), bookkeeping fields are skipped.
 */
export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export const REDACTED = "[redacted]";

/** A value as a short, stable string (dates as ISO, objects as JSON), or null. */
export function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

export function isSensitive(field: string, redact: readonly string[]): boolean {
  const f = field.toLowerCase();
  return redact.some((r) => f.includes(r.toLowerCase()));
}

/**
 * Field-level changes: on create (`before` null) every field set, on delete (`after` null) every field removed, on
 * update only the fields whose value changed.
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: { redact: readonly string[]; ignore: readonly string[] },
): FieldChange[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (f) => !opts.ignore.includes(f),
  );
  const out: FieldChange[] = [];
  for (const field of fields.sort()) {
    const b = show(before?.[field]);
    const a = show(after?.[field]);
    if (before && after && a === b) continue;
    if (!before && a === null) continue;
    if (!after && b === null) continue;
    const secret = isSensitive(field, opts.redact);
    out.push({
      field,
      before: secret && b !== null ? REDACTED : b,
      after: secret && a !== null ? REDACTED : a,
    });
  }
  return out.slice(0, 60);
}

/** One readable line for the log when the caller gave none. */
export function defaultSummary(action: string, changes: FieldChange[]): string {
  const fields = changes.map((c) => c.field);
  const list = fields.length > 4 ? `${fields.slice(0, 4).join(", ")}…` : fields.join(", ");
  return list ? `${action} (${list})` : action;
}

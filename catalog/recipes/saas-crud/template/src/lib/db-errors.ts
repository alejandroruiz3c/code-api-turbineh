/**
 * Database errors the app turns into a clear message instead of a crash. Drizzle wraps the driver's error, so both the
 * error and its cause are checked.
 */
function pgCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A row is still referenced by another (foreign key violation, SQLSTATE 23503). */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgCode(err) === "23503";
}

/** A value breaks a database check (allowed values, non-negative numbers; SQLSTATE 23514). */
export function isCheckViolation(err: unknown): boolean {
  return pgCode(err) === "23514";
}

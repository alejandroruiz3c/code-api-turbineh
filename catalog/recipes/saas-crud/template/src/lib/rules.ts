/**
 * Business rules hook (Backup Coder trigger T3, ADR-0023). Every generated entity has a `check<Entity>Rules`
 * function in `src/entities/<entity>/rules.ts` that runs on the server before a record is created or imported.
 * It returns a user-facing message when the record breaks a rule, otherwise null.
 */
export interface RuleContext<Row> {
  /** Records of the same entity in the active workspace (newest first, bounded). Loaded only when a rule asks. */
  existing: () => Promise<readonly Row[]>;
}

export type EntityRules<Input, Row> = (
  input: Input,
  ctx: RuleContext<Row>,
) => Promise<string | null>;

/** Upper bound of records a rule can inspect (keeps every check fast and predictable). */
export const RULES_SCAN_LIMIT = 5000;

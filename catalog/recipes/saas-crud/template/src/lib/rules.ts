/**
 * Business rules hook (Backup Coder trigger T3, ADR-0023/ADR-0026). Every generated entity has a `check<Entity>Rules`
 * function in `src/entities/<entity>/rules.ts` that runs on the server before a record is created, imported or
 * changed. It returns a user-facing message when the record breaks a rule, otherwise null.
 */
export interface RuleContext<Row, Related = Record<string, never>> {
  /** "create" for new and imported records, "update" when an existing record is changed. */
  operation: "create" | "update";
  /** On update: the record as it was before the change. Null on create. */
  previous: Row | null;
  /**
   * Records of the same entity in the active workspace (newest first, bounded). On update the record being changed
   * is not included, so uniqueness and overlap checks do not compare a record with itself. Loaded only when asked.
   */
  existing: () => Promise<readonly Row[]>;
  /** Read-only loaders of related entities of the same workspace (only those this entity's rules need). */
  related: Related;
}

export type EntityRules<Input, Row, Related = Record<string, never>> = (
  input: Input,
  ctx: RuleContext<Row, Related>,
) => Promise<string | null>;

/** Upper bound of records a rule can inspect (keeps every check fast and predictable). */
export const RULES_SCAN_LIMIT = 5000;

type Loader = (organizationId: string) => Promise<readonly unknown[]>;

/** Loaders bound to one workspace: each runs at most once per check and is read-only. */
export type BoundRelated<L extends Record<string, Loader>> = {
  readonly [K in keyof L]: () => ReturnType<L[K]>;
};

export function bindRelated<L extends Record<string, Loader>>(
  loaders: L,
  organizationId: string,
): BoundRelated<L> {
  const bound: Record<string, () => ReturnType<Loader>> = {};
  for (const [key, load] of Object.entries(loaders) as [string, Loader][]) {
    let rows: ReturnType<Loader> | undefined;
    bound[key] = () => (rows ??= load(organizationId));
  }
  return bound as BoundRelated<L>;
}

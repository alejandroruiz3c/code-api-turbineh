/**
 * Per-record access scopes (ADR-0040). Base behaviour: every member sees every record of their workspace. The
 * component domain.membership-access.turbineh replaces this file with scope membership (company, project, shop…), and
 * every component that stores scoped records (uploads, workflow items, analytics rows) asks these functions.
 */
export interface ScopeContext {
  userId: string;
  organizationId: string;
  role: string;
}

/** Scope ids the member may see, or "all" (no per-record restriction). */
export async function visibleScopes(ctx: ScopeContext): Promise<string[] | "all"> {
  void ctx;
  return "all";
}

/** Whether the member may see a record of `scopeId` (null = a record of the whole workspace). */
export async function canSeeScope(ctx: ScopeContext, scopeId: string | null): Promise<boolean> {
  const scopes = await visibleScopes(ctx);
  return scopes === "all" || scopeId === null || scopes.includes(scopeId);
}

/** Scopes a record can be filed under, for pickers ([] when the app has no per-record scopes). */
export async function scopeOptions(ctx: ScopeContext): Promise<{ id: string; name: string }[]> {
  void ctx;
  return [];
}

/** Label of the scope kind ("Company", "Project", "Shop"…), or null when the app has no per-record scopes. */
export const SCOPE_LABEL: string | null = null;

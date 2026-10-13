import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { accessScopeMembers, accessScopes } from "@/db/schema";
import { membershipConfig } from "@/membership/config";
import { can } from "@/server/role-policy";

/**
 * Per-record access scopes (ADR-0040), implemented by domain.membership-access.turbineh: a member whose role cannot
 * "see_all_scopes" sees only records filed under the scopes they belong to (their company, project or shop); roles that
 * can see every scope (owner, staff, manager…) see the whole workspace. Uploads, workflow items and analytics rows ask
 * these functions, so the rule lives in one place.
 */
export interface ScopeContext {
  userId: string;
  organizationId: string;
  role: string;
}

/** Scope ids the member may see, or "all" (no per-record restriction). */
export async function visibleScopes(ctx: ScopeContext): Promise<string[] | "all"> {
  if (!membershipConfig.scope || can(ctx.role, "see_all_scopes")) return "all";
  const rows = await db
    .select({ id: accessScopeMembers.scopeId })
    .from(accessScopeMembers)
    .where(
      and(
        eq(accessScopeMembers.organizationId, ctx.organizationId),
        eq(accessScopeMembers.userId, ctx.userId),
      ),
    );
  return rows.map((r) => r.id);
}

/** Whether the member may see a record of `scopeId` (null = a record of the whole workspace). */
export async function canSeeScope(ctx: ScopeContext, scopeId: string | null): Promise<boolean> {
  const scopes = await visibleScopes(ctx);
  if (scopes === "all") return true;
  // Members restricted to scopes never see unscoped records of the workspace.
  return scopeId !== null && scopes.includes(scopeId);
}

/** Scopes a record can be filed under, for pickers: every scope for those who see all, otherwise their own. */
export async function scopeOptions(ctx: ScopeContext): Promise<{ id: string; name: string }[]> {
  if (!membershipConfig.scope) return [];
  const visible = await visibleScopes(ctx);
  if (visible !== "all" && visible.length === 0) return [];
  return db
    .select({ id: accessScopes.id, name: accessScopes.name })
    .from(accessScopes)
    .where(
      and(
        eq(accessScopes.organizationId, ctx.organizationId),
        visible === "all" ? undefined : inArray(accessScopes.id, visible),
      ),
    )
    .orderBy(asc(accessScopes.name));
}

/** Label of the scope kind ("Company", "Project", "Shop"…), or null when the app has no per-record scopes. */
export const SCOPE_LABEL: string | null = membershipConfig.scope?.label ?? null;

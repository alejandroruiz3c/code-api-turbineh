// A server action in the app: role check plus the per-record scopes this member may see.
import { can, requireMember } from "@/server/authz";
import { visibleScopes } from "@/server/record-access";
import { UserFacingError } from "@/security/errors";

export async function editableScopes(): Promise<string[] | "all"> {
  const ctx = await requireMember();
  if (!can(ctx.role, "update")) throw new UserFacingError("Viewers cannot edit notes.");
  return visibleScopes(ctx); // "all" or the ids of the member's companies
}

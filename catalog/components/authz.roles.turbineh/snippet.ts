// A server action in the app (e.g. src/app/dashboard/notes/actions.ts): signed-in member, role checked, deny by default.
import { can, requireMember } from "@/server/authz";
import { UserFacingError } from "@/security/errors";

export async function archiveNote(
  noteId: string,
): Promise<{ ok: true; by: string; noteId: string }> {
  const ctx = await requireMember(); // redirects to /sign-in without a session or workspace
  if (!can(ctx.role, "update", "notes")) throw new UserFacingError("Your role cannot edit notes.");
  return { ok: true, by: ctx.userId, noteId };
}

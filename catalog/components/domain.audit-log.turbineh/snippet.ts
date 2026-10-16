// A server action in the app (e.g. src/app/dashboard/notes/actions.ts): the change and its audit entry together.
import { audit } from "@/lib/audit";

export async function recordTitleChange(
  ctx: { organizationId: string; userId: string; email: string },
  note: { id: string; title: string },
  title: string,
): Promise<void> {
  await audit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "note.updated",
    subjectType: "Note",
    subjectId: note.id,
    before: { title: note.title },
    after: { title },
  });
}

import { UserFacingError } from "@/security/errors";
import { getItem } from "@/workflow/service";
import type { Actor } from "./service";

/**
 * Records files can be attached to (storage.private-uploads.turbineh with domain.workflow.turbineh). The scope of an
 * attached file is always the scope of its record, read here on the server — never taken from the form. Workflow
 * records ("workflow:<key>") are loaded with the caller's visibility check, so nobody attaches to a record they
 * cannot see. Add a case for every other kind of record that takes attachments.
 */
export async function resolveSubject(
  ctx: Actor,
  subjectType: string,
  subjectId: string | null,
  requestedScope: string | null,
): Promise<{ scopeId: string | null }> {
  if (subjectType === "workspace" && subjectId === null) return { scopeId: requestedScope };
  const wf = /^workflow:([a-z][a-z0-9_]{0,39})$/.exec(subjectType)?.[1];
  if (wf && subjectId) {
    const item = await getItem(ctx, subjectId);
    if (item.workflow !== wf) throw new UserFacingError("Not found.");
    return { scopeId: item.scopeId };
  }
  throw new UserFacingError("Files cannot be attached to that record.");
}

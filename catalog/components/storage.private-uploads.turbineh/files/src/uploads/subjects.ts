import { UserFacingError } from "@/security/errors";
import type { Actor } from "./service";

/**
 * Records files can be attached to (component storage.private-uploads.turbineh). The scope of an attached file is
 * always the scope of its record, read here on the server — never taken from the form — so a file cannot be filed
 * under a record or scope its uploader cannot see. Add a case for every kind of record that takes attachments.
 */
export async function resolveSubject(
  ctx: Actor,
  subjectType: string,
  subjectId: string | null,
  requestedScope: string | null,
): Promise<{ scopeId: string | null }> {
  void ctx;
  // Loose workspace files: the uploader picks one of their scopes (checked again by saveUpload).
  if (subjectType === "workspace" && subjectId === null) return { scopeId: requestedScope };
  throw new UserFacingError("Files cannot be attached to that record.");
}

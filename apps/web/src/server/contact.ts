import { getWorkspaceContact, normalizeEmail } from "@turbineh/db";
import { createLogger } from "@turbineh/shared";
import { z } from "zod";
import type { Caller } from "./caller";
import { db } from "./db";

const log = createLogger("contact");

export { EMAIL_PURPOSE } from "@/lib/contact";

/** An email address in a request body (`notify_email`, `email`): trimmed, lower-cased, validated. */
export const EmailField = z
  .string()
  .trim()
  .max(254, "The email address is too long")
  .refine((v) => normalizeEmail(v) !== null, "Enter a valid email address")
  .transform((v) => normalizeEmail(v) as string);

/**
 * Contact email of a new plan or build (ADR-0052/0074): the one sent with the request (`notify_email`), else the
 * signed-in account's, else the workspace's (given at the access page). Null when none is known. A failure to read the
 * workspace contact never blocks the request.
 */
export async function contactEmailOf(
  caller: Caller,
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit) return explicit;
  if (caller.kind === "session") return caller.email;
  return getWorkspaceContact(db, caller.ownerId).catch((err: unknown) => {
    log.error("workspace contact not read", {
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return null;
  });
}

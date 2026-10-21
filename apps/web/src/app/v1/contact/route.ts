import {
  deleteWorkspaceContact,
  getWorkspaceContact,
  isPrivateOwner,
  maskEmail,
  setWorkspaceContact,
} from "@turbineh/db";
import { z } from "zod";
import { getCaller } from "@/server/caller";
import { EMAIL_PURPOSE, EmailField } from "@/server/contact";
import { db } from "@/server/db";
import { NOT_JSON, problem, readJson } from "@/server/problem";

export const dynamic = "force-dynamic";

const Body = z.object({ email: EmailField });
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /v1/contact — whether this workspace has a contact email (ADR-0074), masked ("a•••@example.com"): the address
 * itself is never returned. Signed-in accounts use their account email.
 */
export async function GET(): Promise<Response> {
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (caller.kind === "session")
    return Response.json(
      {
        email_on_file: true,
        email: maskEmail(caller.email),
        source: "account",
        purpose: EMAIL_PURPOSE,
      },
      { headers: NO_STORE },
    );
  const shared = !isPrivateOwner(caller.ownerId);
  const email = shared ? null : await getWorkspaceContact(db, caller.ownerId);
  return Response.json(
    {
      email_on_file: Boolean(email),
      email: email ? maskEmail(email) : null,
      source: email ? "workspace" : null,
      // A shared workspace (no random id) cannot hold an email: send notify_email with each request instead.
      shared_workspace: shared,
      purpose: EMAIL_PURPOSE,
    },
    { headers: NO_STORE },
  );
}

/** PUT /v1/contact {email} — sets this workspace's contact email (at most 10 changes a day). */
export async function PUT(req: Request): Promise<Response> {
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  const json = await readJson(req);
  if (json === NOT_JSON) return problem(400, "Invalid JSON", "The request body is not valid JSON.");
  const parsed = Body.safeParse(json);
  if (!parsed.success) return problem(422, "Invalid request", parsed.error.issues[0]?.message);
  if (caller.kind === "session")
    return problem(409, "Signed-in accounts use their account email", undefined, {
      code: "account_email",
    });
  const r = await setWorkspaceContact(db, caller.ownerId, parsed.data.email);
  if (r === "shared_workspace")
    return problem(
      403,
      "A shared workspace cannot hold a contact email",
      "Send x-turbineh-workspace with a random UUID (what `turbineh init` writes), or pass notify_email with each request.",
      { code: "shared_workspace" },
    );
  if (r === "rate_limited")
    return problem(429, "Too many email changes", "Try again tomorrow.", { code: "rate_limited" });
  return Response.json(
    {
      email_on_file: true,
      email: maskEmail(parsed.data.email),
      source: "workspace",
      saved: r === "saved",
    },
    { headers: NO_STORE },
  );
}

/** DELETE /v1/contact — forgets this workspace's contact email. */
export async function DELETE(): Promise<Response> {
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (caller.kind === "session" || !isPrivateOwner(caller.ownerId))
    return new Response(null, { status: 204 });
  await deleteWorkspaceContact(db, caller.ownerId);
  return new Response(null, { status: 204 });
}

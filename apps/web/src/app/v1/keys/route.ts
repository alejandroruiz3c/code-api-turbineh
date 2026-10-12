import { createApiKey, listApiKeys } from "@turbineh/db";
import { z } from "zod";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";

const MAX_ACTIVE = 5;
const Body = z.object({ name: z.string().trim().min(2).max(60) });

/** GET /v1/keys — your active API keys (prefix only). Browser session only: a key cannot list or mint keys. */
export async function GET(): Promise<Response> {
  const caller = await getCaller();
  if (!caller || caller.kind !== "session") return problem(401, "Sign in to manage API keys");
  return Response.json({ keys: await listApiKeys(db, caller.ownerId) });
}

/** POST /v1/keys — creates a key; the full key is returned once and only its hash is stored. */
export async function POST(req: Request): Promise<Response> {
  const caller = await getCaller();
  if (!caller || caller.kind !== "session") return problem(401, "Sign in to manage API keys");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "Give the key a name (2–60 characters)");
  if ((await listApiKeys(db, caller.ownerId)).length >= MAX_ACTIVE) {
    return problem(409, "Too many active keys", `Revoke one first (maximum ${MAX_ACTIVE}).`);
  }
  const { id, key } = await createApiKey(db, caller.ownerId, parsed.data.name);
  return Response.json({ id, key, prefix: key.slice(0, 8) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

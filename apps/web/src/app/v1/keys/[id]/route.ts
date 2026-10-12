import { revokeApiKey } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";

/** DELETE /v1/keys/{id} — revokes one of your keys immediately. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await getCaller();
  if (!caller || caller.kind !== "session") return problem(401, "Sign in to manage API keys");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return problem(404, "Key not found");
  return (await revokeApiKey(db, caller.ownerId, id))
    ? new Response(null, { status: 204 })
    : problem(404, "Key not found");
}

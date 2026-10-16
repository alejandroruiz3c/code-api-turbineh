"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";
import { disconnect } from "@/social/connections";

/** Disconnects a social account (social.connections.turbineh): revokes at the provider when it can, deletes the tokens. */
export async function disconnectAccount(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().safeParse(formData.get("id"));
  const back = new URLSearchParams();
  if (!(await rateLimit(`social:disconnect:${ctx.userId}`, 20)))
    back.set("error", "Too many attempts. Try again in a minute.");
  else if (!id.success) back.set("error", "Unknown account.");
  else {
    try {
      const r = await disconnect(ctx, id.data);
      back.set("disconnected", r.revoked);
      if (r.note) back.set("note", r.note);
    } catch (err) {
      back.set("error", toUserMessage(err));
    }
  }
  redirect(`/dashboard/social?${back}`);
}

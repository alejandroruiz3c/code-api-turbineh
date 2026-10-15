"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { acceptInvitation } from "@/membership/service";
import { toUserMessage } from "@/security/errors";
import { requireSession } from "@/server/authz";

/** Accept an invitation: the signed-in person (not a member yet) joins the workspace with the invited role. */
export type AcceptState = { error: string } | null;

export async function acceptInvitationAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const session = await requireSession();
  const token = z.string().min(20).max(100).safeParse(formData.get("token"));
  if (!token.success) return { error: "This invitation is not valid." };
  let organizationId: string;
  try {
    organizationId = await acceptInvitation(session, token.data);
  } catch (err) {
    return { error: toUserMessage(err) };
  }
  await auth.api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
  redirect("/dashboard");
}

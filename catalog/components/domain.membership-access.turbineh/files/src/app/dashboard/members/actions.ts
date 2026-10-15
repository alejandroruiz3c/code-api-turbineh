"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addToScope,
  changeRole,
  createScope,
  invite,
  revokeInvitation,
} from "@/membership/service";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";

/** Members, invitations and scopes (domain.membership-access.turbineh): only roles that manage members. */
export type MembersState = { ok: boolean; message: string; link?: string } | null;

async function requireManager() {
  const ctx = await requireMember();
  if (!can(ctx.role, "manage_members")) throw new Error("not allowed");
  return ctx;
}

const inviteSchema = z.object({
  email: z.email().max(320),
  role: z.string().min(1).max(24),
  scopeId: z.union([z.uuid(), z.literal("")]).optional(),
});

export async function inviteMember(_prev: MembersState, formData: FormData): Promise<MembersState> {
  const ctx = await requireMember();
  if (!can(ctx.role, "manage_members"))
    return { ok: false, message: "You are not allowed to invite people." };
  if (!(await rateLimit(`invite:${ctx.userId}`, 20)))
    return { ok: false, message: "Too many invitations. Try again later." };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Enter a valid email and choose a role." };
  try {
    const { link } = await invite(ctx, {
      email: parsed.data.email,
      role: parsed.data.role,
      scopeId: parsed.data.scopeId || null,
    });
    revalidatePath("/dashboard/members");
    return { ok: true, message: `Invitation sent to ${parsed.data.email.toLowerCase()}.`, link };
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
}

export async function revokeMemberInvitation(formData: FormData): Promise<void> {
  const ctx = await requireManager();
  await revokeInvitation(ctx, z.uuid().parse(formData.get("id")));
  revalidatePath("/dashboard/members");
}

export async function changeMemberRole(
  _prev: MembersState,
  formData: FormData,
): Promise<MembersState> {
  const ctx = await requireMember();
  if (!can(ctx.role, "manage_members"))
    return { ok: false, message: "You are not allowed to do that." };
  const memberId = z.string().min(1).max(64).parse(formData.get("memberId"));
  const role = String(formData.get("role") ?? "");
  try {
    await changeRole(ctx, memberId, role === "__remove" ? null : role);
    revalidatePath("/dashboard/members");
    return { ok: true, message: role === "__remove" ? "Member removed." : "Role changed." };
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
}

export async function createAccessScope(formData: FormData): Promise<void> {
  const ctx = await requireManager();
  await createScope(ctx, z.string().trim().min(1).max(120).parse(formData.get("name")));
  revalidatePath("/dashboard/members");
}

export async function addScopeMember(formData: FormData): Promise<void> {
  const ctx = await requireManager();
  await addToScope(
    ctx,
    z.uuid().parse(formData.get("scopeId")),
    z.email().parse(formData.get("email")),
  );
  revalidatePath("/dashboard/members");
}

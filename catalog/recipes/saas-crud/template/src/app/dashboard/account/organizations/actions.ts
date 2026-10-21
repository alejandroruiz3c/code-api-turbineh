"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toUserMessage, UserFacingError } from "@/security/errors";
import { requireSession } from "@/server/authz";
import { organizationSlug } from "@/lib/organization-slug";
import { myOrganizations } from "@/server/organizations";

/**
 * Switches the signed-in person's active organization (workspace). Only an organization they are a member of: the id
 * comes from the form, so membership is checked on the server before better-auth sets it on the session. Every page
 * and action then reads data of the new active organization only (requireMember()).
 */
export async function switchOrganization(form: FormData): Promise<void> {
  const { userId } = await requireSession();
  const id = z.string().min(1).max(64).safeParse(form.get("organizationId"));
  if (!id.success) throw new UserFacingError("Choose an organization.");
  const mine = await myOrganizations(userId);
  if (!mine.some((o) => o.id === id.data))
    throw new UserFacingError("You are not a member of that organization.");
  await auth.api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId: id.data },
  });
  redirect("/dashboard");
}

export type CreateOrganizationState = { error: string | null };

const createSchema = z.object({ name: z.string().trim().min(2).max(60) });

/** Creates another organization with the signed-in person as its owner and makes it the active one. */
export async function createOrganization(
  _prev: CreateOrganizationState,
  form: FormData,
): Promise<CreateOrganizationState> {
  await requireSession();
  const parsed = createSchema.safeParse({ name: form.get("name") });
  if (!parsed.success) return { error: "Name the organization (2 to 60 characters)." };
  const h = await headers();
  try {
    const org = await auth.api.createOrganization({
      headers: h,
      body: { name: parsed.data.name, slug: organizationSlug(parsed.data.name) },
    });
    if (!org) return { error: "Could not create the organization." };
    await auth.api.setActiveOrganization({ headers: h, body: { organizationId: org.id } });
  } catch (err) {
    return { error: toUserMessage(err) };
  }
  redirect("/dashboard");
}

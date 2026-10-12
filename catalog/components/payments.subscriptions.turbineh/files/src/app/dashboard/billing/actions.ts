"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { billingConfigured, billingEnv, stripePost, workspacePlan } from "@/lib/billing";
import { UserFacingError } from "@/security/errors";
import { can, requireMember } from "@/server/authz";

const base = () => (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");

/** Owners and admins start the Pro subscription on Stripe's hosted Checkout page. */
export async function upgrade(): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "update"))
    throw new UserFacingError("Only owners and admins can change the plan.");
  if (!billingConfigured()) throw new UserFacingError("Billing is not configured yet.");
  const session = await auth.api.getSession({ headers: await headers() });
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": billingEnv.STRIPE_PRICE_PRO ?? "",
    "line_items[0][quantity]": "1",
    client_reference_id: ctx.organizationId,
    "metadata[organization_id]": ctx.organizationId,
    "subscription_data[metadata][organization_id]": ctx.organizationId,
    success_url: `${base()}/dashboard/billing?success=1`,
    cancel_url: `${base()}/dashboard/billing`,
    ...(session?.user.email ? { customer_email: session.user.email } : {}),
  });
  const s = (await stripePost(
    "/v1/checkout/sessions",
    form,
    `sub-${ctx.organizationId}-${Date.now()}`,
  )) as { url?: string };
  if (!s.url || new URL(s.url).hostname !== "checkout.stripe.com")
    throw new UserFacingError("The payment page could not be opened.");
  // Stripe-hosted page (constant host, checked above).
  // nosemgrep: turbineh.open-redirect
  redirect(s.url);
}

/** Owners and admins manage the card, invoices and cancellation in Stripe's Customer Portal. */
export async function manageBilling(): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "update"))
    throw new UserFacingError("Only owners and admins can manage billing.");
  const sub = await workspacePlan(ctx.organizationId);
  if (!sub.stripeCustomerId) throw new UserFacingError("There is no subscription to manage yet.");
  const p = (await stripePost(
    "/v1/billing_portal/sessions",
    new URLSearchParams({
      customer: sub.stripeCustomerId,
      return_url: `${base()}/dashboard/billing`,
    }),
  )) as { url?: string };
  if (!p.url || !new URL(p.url).hostname.endsWith("stripe.com"))
    throw new UserFacingError("The billing portal could not be opened.");
  // nosemgrep: turbineh.open-redirect
  redirect(p.url);
}

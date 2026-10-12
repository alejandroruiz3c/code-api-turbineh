import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { hasPaidAccess } from "@/lib/billing-rules";
import { requireMember } from "@/server/authz";

/**
 * Subscriptions with Stripe Billing (component payments.subscriptions.turbineh) through the documented REST API:
 * Checkout in subscription mode, Customer Portal, signed webhooks. No SDK and no card data in the app.
 */
export const billingEnv = z
  .object({
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    /** Price of the "Pro" plan in Stripe (price_…). */
    STRIPE_PRICE_PRO: z.string().startsWith("price_").optional(),
    STRIPE_API_BASE: z.url().default("https://api.stripe.com"),
  })
  .parse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || undefined,
    STRIPE_API_BASE: process.env.STRIPE_API_BASE || undefined,
  });

export const billingConfigured = () =>
  Boolean(billingEnv.STRIPE_SECRET_KEY && billingEnv.STRIPE_PRICE_PRO);

export async function stripePost(
  path: string,
  form: URLSearchParams,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${billingEnv.STRIPE_API_BASE.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${billingEnv.STRIPE_SECRET_KEY ?? ""}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form,
  });
  const body = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
  return body;
}

export async function workspacePlan(organizationId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));
  return (
    row ?? {
      organizationId,
      plan: "free",
      status: "none",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    }
  );
}

/** Guard for paid features: members of workspaces without an active Pro plan are sent to the billing page. */
export async function requirePlan(plan: "pro") {
  const ctx = await requireMember();
  const s = await workspacePlan(ctx.organizationId);
  if (!(plan === "pro" && hasPaidAccess(s.plan, s.status)))
    redirect("/dashboard/billing?upgrade=1");
  return ctx;
}

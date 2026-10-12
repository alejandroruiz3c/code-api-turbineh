import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { billingEnv } from "@/lib/billing";
import { verifySignature } from "@/lib/billing-rules";

interface StripeEvent {
  type: string;
  data: {
    object: {
      id: string;
      mode?: string;
      customer?: string | null;
      subscription?: string | null;
      client_reference_id?: string | null;
      status?: string;
      current_period_end?: number | null;
      metadata?: Record<string, string> | null;
    };
  };
}

const ORG = /^[A-Za-z0-9_-]{1,64}$/;

/** Stripe Billing webhook: the only writer of subscription state. Signed, idempotent upserts. */
export async function POST(req: Request): Promise<Response> {
  if (!billingEnv.STRIPE_WEBHOOK_SECRET)
    return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  if (
    !verifySignature(raw, req.headers.get("stripe-signature"), billingEnv.STRIPE_WEBHOOK_SECRET)
  ) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(raw) as StripeEvent;
  const o = event.data.object;
  const org = o.client_reference_id ?? o.metadata?.organization_id ?? "";
  if (!ORG.test(org)) return Response.json({ received: true });
  const end = o.current_period_end ? new Date(o.current_period_end * 1000) : null;
  if (event.type === "checkout.session.completed" && o.mode === "subscription") {
    await db
      .insert(subscriptions)
      .values({
        organizationId: org,
        stripeCustomerId: o.customer ?? null,
        stripeSubscriptionId: o.subscription ?? null,
        plan: "pro",
        status: "active",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.organizationId,
        set: {
          stripeCustomerId: o.customer ?? null,
          stripeSubscriptionId: o.subscription ?? null,
          plan: "pro",
          status: "active",
          updatedAt: new Date(),
        },
      });
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const status =
      event.type === "customer.subscription.deleted" ? "canceled" : (o.status ?? "active");
    await db
      .insert(subscriptions)
      .values({
        organizationId: org,
        stripeCustomerId: o.customer ?? null,
        stripeSubscriptionId: o.id,
        plan: "pro",
        status,
        currentPeriodEnd: end,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.organizationId,
        set: { status, currentPeriodEnd: end, updatedAt: sql`now()` },
      });
  }
  return Response.json({ received: true });
}

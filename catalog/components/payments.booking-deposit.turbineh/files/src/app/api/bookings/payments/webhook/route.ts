import { handleStripeEvent } from "@/payments/service";

/** Stripe webhook of the booking payment step (payments.booking-deposit.turbineh): signed, idempotent. */
export async function POST(req: Request): Promise<Response> {
  const out = await handleStripeEvent(await req.text(), req.headers.get("stripe-signature"));
  return out.status === 200
    ? Response.json(out.body)
    : new Response(out.body, { status: out.status });
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { billingConfigured, workspacePlan } from "@/lib/billing";
import { hasPaidAccess } from "@/lib/billing-rules";
import { can, requireMember } from "@/server/authz";
import { manageBilling, upgrade } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Billing({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const sp = await searchParams;
  const sub = await workspacePlan(ctx.organizationId);
  const pro = hasPaidAccess(sub.plan, sub.status);
  const admin = can(ctx.role, "update");
  return (
    <Card title="Plan and billing">
      <div data-workspace={ctx.organizationId}>
        {sp.upgrade ? (
          <p className="mb-3 text-warning">This feature is part of the Pro plan.</p>
        ) : null}
        {sp.success ? (
          <p className="mb-3 text-success">
            Thank you! Your plan updates as soon as Stripe confirms the payment.
          </p>
        ) : null}
        <p className="text-lg">
          Current plan: <strong data-testid="plan">{pro ? "Pro" : "Free"}</strong>
          {sub.currentPeriodEnd && pro ? (
            <span className="text-sm text-muted">
              {" "}
              · renews {sub.currentPeriodEnd.toISOString().slice(0, 10)}
            </span>
          ) : null}
        </p>
        {!billingConfigured() ? (
          <p className="mt-3 text-sm text-muted">
            Billing is not configured yet (STRIPE_SECRET_KEY and STRIPE_PRICE_PRO).
          </p>
        ) : admin ? (
          <div className="mt-4 flex gap-3">
            {!pro ? (
              <form action={upgrade}>
                <Button type="submit">Upgrade to Pro</Button>
              </form>
            ) : null}
            {sub.stripeCustomerId ? (
              <form action={manageBilling}>
                <button type="submit" className="rounded-md border border-field px-4 py-2 text-sm">
                  Manage billing
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Ask an owner or admin to change the plan.</p>
        )}
      </div>
    </Card>
  );
}

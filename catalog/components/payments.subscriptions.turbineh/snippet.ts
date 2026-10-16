// Server code in the app (e.g. src/app/dashboard/reports/page.tsx): a paid-only feature.
import { billingConfigured, requirePlan, workspacePlan } from "@/lib/billing";
import { hasPaidAccess } from "@/lib/billing-rules";

export async function proReport() {
  const ctx = await requirePlan("pro"); // members without an active Pro plan go to /dashboard/billing
  const plan = await workspacePlan(ctx.organizationId);
  return { organizationId: ctx.organizationId, plan: plan.plan, stripeReady: billingConfigured() };
}

export const isPro = hasPaidAccess("pro", "active"); // → true

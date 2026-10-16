// A server action in the app (e.g. src/app/dashboard/workflow/actions.ts).
import { requireMember } from "@/server/authz";
import { createItem, transition } from "@/workflow/service";

export async function requestAndApprove(workflow: string, approvedState: string): Promise<string> {
  const ctx = await requireMember();
  const id = await createItem(ctx, {
    workflow,
    title: "Sony FX3 · 14–16 Oct",
    dueAt: new Date("2026-10-16"),
  });
  await transition(ctx, id, approvedState, "Approved for the shoot"); // throws if the role cannot
  return id;
}

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireMember } from "@/server/authz";
import { workflowConfig } from "@/workflow/config";
import { stateLabel } from "@/workflow/engine";
import { listItems } from "@/workflow/service";

/** Workflows overview: records per state for each workflow, and what needs attention (stuck or overdue). */
export default async function WorkflowsPage() {
  const ctx = await requireMember();
  const all = await Promise.all(
    workflowConfig.workflows.map(async (wf) => ({ wf, items: await listItems(ctx, wf.key) })),
  );
  const attention = all.flatMap(({ wf, items }) =>
    items.filter((i) => i.stuckHours !== null || i.overdue).map((i) => ({ wf, i })),
  );
  return (
    <div className="flex flex-col gap-6">
      {attention.length ? (
        <Card title="Needs attention">
          <ul className="flex flex-col gap-2 text-sm" data-testid="attention">
            {attention.map(({ wf, i }) => (
              <li key={i.id} className="rounded-md bg-warning-soft px-3 py-2 text-warning">
                <Link href={`/dashboard/workflow/${wf.key}/${i.id}`} className="font-medium">
                  {i.title}
                </Link>{" "}
                — {stateLabel(wf, i.state)}
                {i.stuckHours !== null ? ` for ${i.stuckHours} h (over the limit)` : ""}
                {i.overdue ? " · overdue" : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {all.map(({ wf, items }) => (
        <Card key={wf.key} title={wf.plural}>
          <ul className="flex flex-wrap gap-3 text-sm">
            {wf.states.map((s) => (
              <li key={s.key} className="rounded-md border border-line bg-subtle px-3 py-2">
                {s.label}: <strong>{items.filter((i) => i.state === s.key).length}</strong>
              </li>
            ))}
          </ul>
          <Link
            className="mt-4 inline-block text-sm text-accent underline"
            href={`/dashboard/workflow/${wf.key}`}
          >
            Open {wf.plural.toLowerCase()}
          </Link>
        </Card>
      ))}
    </div>
  );
}

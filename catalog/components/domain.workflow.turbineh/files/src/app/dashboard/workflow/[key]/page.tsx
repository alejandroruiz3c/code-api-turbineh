import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireMember } from "@/server/authz";
import { scopeOptions, SCOPE_LABEL } from "@/server/record-access";
import { workflowOf } from "@/workflow/config";
import { canCreate } from "@/workflow/engine";
import { listItems } from "@/workflow/service";
import { createWorkflowItem } from "../actions";

type Props = { params: Promise<{ key: string }> };

/** Records of one workflow grouped by state, with stuck/overdue flags and a form to create one. */
export default async function WorkflowListPage({ params }: Props) {
  const { key } = await params;
  const wf = workflowOf(key);
  if (!wf) notFound();
  const ctx = await requireMember();
  const [items, scopes] = await Promise.all([listItems(ctx, wf.key), scopeOptions(ctx)]);
  return (
    <div className="flex flex-col gap-6">
      {canCreate(wf, ctx.role) ? (
        <Card title={`New ${wf.label.toLowerCase()}`}>
          <form action={createWorkflowItem} className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input type="hidden" name="workflow" value={wf.key} />
            <div className="md:col-span-2">
              <Label htmlFor="wf-title">Title</Label>
              <Input id="wf-title" name="title" required maxLength={200} />
            </div>
            {wf.dueDate ? (
              <div>
                <Label htmlFor="wf-due">Due date</Label>
                <Input id="wf-due" name="dueAt" type="date" />
              </div>
            ) : null}
            {SCOPE_LABEL && scopes.length ? (
              <div>
                <Label htmlFor="wf-scope">{SCOPE_LABEL}</Label>
                <select
                  id="wf-scope"
                  name="scopeId"
                  className="w-full rounded-md border border-field px-3 py-2 text-sm"
                >
                  {scopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="md:col-span-4">
              <Label htmlFor="wf-description">Description</Label>
              <textarea
                id="wf-description"
                name="description"
                maxLength={5000}
                rows={2}
                className="w-full rounded-md border border-field px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Button type="submit">Create {wf.label.toLowerCase()}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {wf.states.map((s) => {
          const inState = items.filter((i) => i.state === s.key);
          return (
            <section
              key={s.key}
              aria-label={s.label}
              className="rounded-lg border border-line bg-panel p-4"
              data-testid={`state-${s.key}`}
            >
              <h2 className="mb-3 font-semibold">
                {s.label} <span className="text-muted">({inState.length})</span>
              </h2>
              <ul className="flex flex-col gap-2 text-sm">
                {inState.map((i) => (
                  <li key={i.id} className="rounded-md border border-line bg-surface px-3 py-2">
                    <Link href={`/dashboard/workflow/${wf.key}/${i.id}`} className="font-medium">
                      {i.title}
                    </Link>
                    {i.stuckHours !== null ? (
                      <span className="ml-2 rounded bg-warning-soft px-2 text-xs text-warning">
                        Stuck {i.stuckHours} h
                      </span>
                    ) : null}
                    {i.overdue ? (
                      <span className="ml-2 rounded bg-danger-soft px-2 text-xs text-danger">
                        Overdue
                      </span>
                    ) : null}
                    {i.dueAt ? (
                      <div className="text-xs text-muted">
                        Due {i.dueAt.toISOString().slice(0, 10)}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

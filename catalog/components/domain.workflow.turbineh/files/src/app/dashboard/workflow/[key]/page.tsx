import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireMember } from "@/server/authz";
import { scopeOptions, SCOPE_LABEL } from "@/server/record-access";
import { workflowOf } from "@/workflow/config";
import { WorkflowBoard } from "@/workflow/board";
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
      <WorkflowBoard ctx={ctx} wf={wf} items={items} />
    </div>
  );
}

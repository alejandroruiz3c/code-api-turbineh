import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { requireMember } from "@/server/authz";
import { workflowOf } from "@/workflow/config";
import { allowedTransitions, isOverdue, stateLabel, stuckHours } from "@/workflow/engine";
import { getItem, history } from "@/workflow/service";
import { TransitionForm } from "../../transition-form";

type Props = { params: Promise<{ key: string; id: string }> };

/** One record: current state, the transitions this person may make, and its immutable history (who, when). */
export default async function WorkflowItemPage({ params }: Props) {
  const { key, id } = await params;
  const wf = workflowOf(key);
  if (!wf || !z.uuid().safeParse(id).success) notFound();
  const ctx = await requireMember();
  const item = await getItem(ctx, id).catch(() => null);
  if (!item || item.workflow !== wf.key) notFound();
  const events = await history(ctx, id);
  const now = new Date();
  const stuck = stuckHours(wf, item.state, item.stateSince, now);
  const transitions = allowedTransitions(wf, item.state, {
    role: ctx.role,
    isCreator: item.createdBy === ctx.userId,
  });
  return (
    <div className="flex flex-col gap-6">
      <Link href={`/dashboard/workflow/${wf.key}`} className="text-sm text-accent underline">
        ← {wf.plural}
      </Link>
      <Card title={item.title}>
        <p className="text-sm">
          Status: <strong data-testid="current-state">{stateLabel(wf, item.state)}</strong> since{" "}
          {item.stateSince.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
        {stuck !== null ? (
          <p
            className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
            data-testid="stuck"
          >
            Stuck: {stuck} h in {stateLabel(wf, item.state)} (over the limit)
          </p>
        ) : null}
        {isOverdue(wf, item.state, item.dueAt, now) ? (
          <p
            className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
            data-testid="overdue"
          >
            Overdue since {item.dueAt?.toISOString().slice(0, 10)}
          </p>
        ) : null}
        {item.description ? (
          <p className="mt-3 whitespace-pre-wrap text-sm">{item.description}</p>
        ) : null}
      </Card>
      <Card title="Change status">
        {transitions.length ? (
          <TransitionForm
            id={item.id}
            transitions={transitions.map((t) => ({ to: t.to, label: t.label }))}
          />
        ) : (
          <p className="text-sm text-muted">No status change available to you from here.</p>
        )}
      </Card>
      <Card title="History">
        <ol className="flex flex-col gap-2 text-sm" data-testid="history">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-line pl-3">
              <span className="font-medium">
                {e.fromState ? `${stateLabel(wf, e.fromState)} → ` : "Created as "}
                {stateLabel(wf, e.toState)}
              </span>{" "}
              by {e.actorEmail ?? e.actorId} on{" "}
              {e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
              {e.note ? <div className="text-muted">“{e.note}”</div> : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">History entries cannot be edited or deleted.</p>
      </Card>
    </div>
  );
}

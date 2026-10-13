import Link from "next/link";
import type { Workflow } from "./config";
import type { Actor, ListedItem } from "./service";

/**
 * Records of one workflow grouped by state, with stuck/overdue flags (component domain.workflow.turbineh). A static
 * board by default; ui.kanban.turbineh replaces this file with a drag-and-drop board (keyboard accessible) whose
 * moves go through the same server-checked transitions.
 */
export function WorkflowBoard({ wf, items }: { ctx: Actor; wf: Workflow; items: ListedItem[] }) {
  return (
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
  );
}

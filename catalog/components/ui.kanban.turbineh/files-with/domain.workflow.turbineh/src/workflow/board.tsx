import { moveCard } from "@/app/dashboard/workflow/board-actions";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { isBoard, kanbanConfig as cfg } from "@/kanban/config";
import type { Workflow } from "./config";
import { allowedTransitions } from "./engine";
import type { Actor, ListedItem } from "./service";

/**
 * Board of one workflow (domain.workflow.turbineh), replaced by ui.kanban.turbineh: a kanban board whose columns are
 * the workflow's states. Each card knows the columns this person may move it to (transitions × role); every move is a
 * server-checked transition with history.
 */
export function WorkflowBoard({
  ctx,
  wf,
  items,
}: {
  ctx: Actor;
  wf: Workflow;
  items: ListedItem[];
}) {
  const movable = cfg.dragAndDrop && isBoard(wf.key, cfg);
  return (
    <KanbanBoard
      columns={wf.states.map((s) => ({ key: s.key, label: s.label }))}
      dragAndDrop={movable}
      move={moveCard}
      cards={items.map((i) => ({
        id: i.id,
        title: i.title,
        column: i.state,
        href: `/dashboard/workflow/${wf.key}/${i.id}`,
        allowed: allowedTransitions(wf, i.state, {
          role: ctx.role,
          isCreator: i.createdBy === ctx.userId,
        }).map((t) => t.to),
        badges: [
          ...(cfg.highlightOverdue && i.overdue
            ? [{ label: "Overdue", tone: "danger" as const }]
            : []),
          ...(cfg.highlightOverdue && i.stuckHours !== null
            ? [{ label: `Stuck ${i.stuckHours} h`, tone: "warning" as const }]
            : []),
          ...(i.dueAt
            ? [{ label: `Due ${i.dueAt.toISOString().slice(0, 10)}`, tone: "muted" as const }]
            : []),
        ],
      }))}
    />
  );
}

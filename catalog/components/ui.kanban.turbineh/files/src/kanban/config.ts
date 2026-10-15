import { z } from "zod";
import params from "./params.json";

/**
 * Kanban boards (component ui.kanban.turbineh), written by TurbineH from the request ("a Kanban board per project
 * with drag-and-drop between statuses"): which workflows are shown as boards, whether cards can be moved, whether late
 * cards are highlighted. Validated at start-up.
 */
export const KanbanParams = z.object({
  workflows: z
    .array(z.string().regex(/^(\*|[a-z][a-z0-9_]{0,39})$/))
    .min(1)
    .max(10),
  dragAndDrop: z.boolean(),
  highlightOverdue: z.boolean(),
});
export type KanbanConfig = z.infer<typeof KanbanParams>;

export const kanbanConfig: KanbanConfig = KanbanParams.parse(params);

/** Whether a workflow is shown as a kanban board. */
export function isBoard(workflow: string, cfg: KanbanConfig = kanbanConfig): boolean {
  return cfg.workflows.includes("*") || cfg.workflows.includes(workflow);
}

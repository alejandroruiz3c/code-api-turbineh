/** Pure board rules (recipe projects), unit-tested in tests/unit/board.test.ts. */

export const STATUSES = ["todo", "doing", "review", "done"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  doing: "In progress",
  review: "In review",
  done: "Done",
};

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const isStatus = (v: string): v is Status => (STATUSES as readonly string[]).includes(v);
export const isPriority = (v: string): v is Priority =>
  (PRIORITIES as readonly string[]).includes(v);

/** Neighbouring column for the keyboard-accessible "move" buttons (null at the edges). */
export function neighbour(status: Status, dir: -1 | 1): Status | null {
  return STATUSES[STATUSES.indexOf(status) + dir] ?? null;
}

/** Overdue = has a due date before today (UTC) and is not done. */
export function isOverdue(
  due: string | null,
  status: Status,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return Boolean(due) && status !== "done" && (due ?? "") < today;
}

/** Sort for "My tasks": overdue first, then by due date (no date last), then by priority. */
export function byUrgency(
  a: { dueDate: string | null; priority: string },
  b: { dueDate: string | null; priority: string },
): number {
  // Higher index = more urgent (low < medium < high < urgent).
  const rank = (p: string) => (isPriority(p) ? PRIORITIES.indexOf(p) : -1);
  const da = a.dueDate ?? "9999-12-31";
  const db = b.dueDate ?? "9999-12-31";
  return da.localeCompare(db) || rank(b.priority) - rank(a.priority);
}

/** Archive flag from a form ("archive" → 1, "restore" → 0); anything else is refused. */
export function archiveFlag(action: unknown): 0 | 1 | null {
  if (action === "archive") return 1;
  if (action === "restore") return 0;
  return null;
}

/** Splits rows into the active ones (board, lists) and the archived ones ("Archived" sections). */
export function splitArchived<T extends { archived: number }>(
  rows: readonly T[],
): { active: T[]; archived: T[] } {
  return {
    active: rows.filter((r) => r.archived === 0),
    archived: rows.filter((r) => r.archived !== 0),
  };
}

/**
 * Keyboard moves on a kanban board (component ui.kanban.turbineh), as pure functions unit-tested in
 * tests/unit/kanban.test.ts. A card is picked up with Space or Enter, ArrowLeft/ArrowRight choose a column (only the
 * columns the card may move to, wrapping around), Enter or Space drops it there and Escape puts it back.
 */
export type KeyAction =
  | { type: "pick" }
  | { type: "target"; column: string }
  | { type: "drop"; column: string }
  | { type: "cancel" }
  | null;

/** Next column among `allowed` and the card's `home` column (board order), from `current`, in direction `dir`. */
export function nextColumn(
  columns: readonly string[],
  allowed: readonly string[],
  current: string,
  dir: 1 | -1,
  home: string = current,
): string {
  const order = columns.filter((c) => allowed.includes(c) || c === current || c === home);
  if (order.length <= 1) return current;
  const i = order.indexOf(current);
  return order[(i + dir + order.length) % order.length] ?? current;
}

/** What a key does, given whether a card is picked up and the column it currently points at. */
export function keyAction(
  key: string,
  state: { picked: boolean; home: string; target: string },
  columns: readonly string[],
  allowed: readonly string[],
): KeyAction {
  if (!state.picked) return key === " " || key === "Enter" ? { type: "pick" } : null;
  if (key === "Escape") return { type: "cancel" };
  if (key === "ArrowRight" || key === "ArrowLeft")
    return {
      type: "target",
      column: nextColumn(columns, allowed, state.target, key === "ArrowRight" ? 1 : -1, state.home),
    };
  if (key === " " || key === "Enter")
    return state.target === state.home
      ? { type: "cancel" }
      : { type: "drop", column: state.target };
  return null;
}

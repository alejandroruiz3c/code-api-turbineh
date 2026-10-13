/**
 * One flow row carries several runs (ADR-0050): the plan run, then the generation run queued on the same row (and a
 * "Generate again" after a failure). Each run starts with a `queued` event and ends with a `finished` event, so a
 * `finished` event is the end of the flow only when nothing was queued after it. Before this rule, the plan's own
 * `finished` closed the live trace of the generation at once and the page reported "nothing was delivered" while the
 * app was still being built (production, 2026-10-13).
 */
export interface TraceEvent {
  id: number;
  phase: string;
  type: string;
}

/** Events of the latest run only (from its `queued` event on). */
export function currentRun<E extends TraceEvent>(events: E[]): E[] {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === "queued") {
      start = i;
      break;
    }
  }
  return start <= 0 ? events : events.slice(start);
}

/** The `finished` event that ends the flow: the last event of all, and a `finished` one. */
export function finalFinish<E extends TraceEvent>(events: E[]): E | undefined {
  const last = events.at(-1);
  return last?.type === "finished" ? last : undefined;
}

/** Statuses of a build row that are still working (the page keeps following them). */
export const RUNNING_STATUSES = new Set(["queued", "running"]);

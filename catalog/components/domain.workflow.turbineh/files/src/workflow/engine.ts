import type { Workflow } from "./config";

/**
 * Workflow rules (component domain.workflow.turbineh): pure functions, unit-tested. Which transitions a person may
 * make from a state, whether a record is stuck or overdue. The service, the pages and the board use only these.
 */
export interface Actor {
  role: string;
  /** Whether the person created the record ("creator" transitions). */
  isCreator: boolean;
}

const allowedFor = (roles: readonly string[], actor: Actor) =>
  roles.includes("*") ||
  roles.includes(actor.role) ||
  (actor.isCreator && roles.includes("creator"));

/** Transitions available from `state` to this person (none from a final state). */
export function allowedTransitions(wf: Workflow, state: string, actor: Actor) {
  if (wf.states.find((s) => s.key === state)?.final) return [];
  return wf.transitions.filter((t) => t.from.includes(state) && allowedFor(t.roles, actor));
}

/** Why a transition is refused, or null when it is allowed. */
export function transitionError(
  wf: Workflow,
  from: string,
  to: string,
  actor: Actor,
): string | null {
  const state = (k: string) => wf.states.find((s) => s.key === k)?.label ?? k;
  if (!wf.states.some((s) => s.key === to)) return `Unknown state "${to}".`;
  const exists = wf.transitions.some((t) => t.from.includes(from) && t.to === to);
  if (!exists || wf.states.find((s) => s.key === from)?.final)
    return `A ${wf.label.toLowerCase()} cannot go from ${state(from)} to ${state(to)}.`;
  if (!allowedTransitions(wf, from, actor).some((t) => t.to === to))
    return `Your role cannot move a ${wf.label.toLowerCase()} from ${state(from)} to ${state(to)}.`;
  return null;
}

export function canCreate(wf: Workflow, role: string): boolean {
  return wf.createRoles.includes("*") || wf.createRoles.includes(role);
}

/** Hours a record has been in its state when that exceeds the state's limit, otherwise null. */
export function stuckHours(wf: Workflow, state: string, since: Date, now: Date): number | null {
  const limit = wf.states.find((s) => s.key === state)?.limitHours ?? null;
  if (limit === null) return null;
  const hours = (now.getTime() - since.getTime()) / 3_600_000;
  return hours > limit ? Math.floor(hours) : null;
}

/** Past its due date and not in a final state. */
export function isOverdue(wf: Workflow, state: string, dueAt: Date | null, now: Date): boolean {
  if (!dueAt) return false;
  return !wf.states.find((s) => s.key === state)?.final && dueAt.getTime() < now.getTime();
}

export function stateLabel(wf: Workflow, state: string): string {
  return wf.states.find((s) => s.key === state)?.label ?? state;
}

import { z } from "zod";
import params from "./params.json";

/**
 * Workflow definitions (component domain.workflow.turbineh), written by TurbineH from the request: for each kind of
 * record (request, loan, piece, task…) its states, the initial state, the allowed transitions and who may make them
 * (role keys, "creator" = whoever created the record, "*" = any member), and how long a record may stay in a state
 * before it is flagged as stuck. Validated at start-up: an inconsistent workflow fails loudly.
 */
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase key");

export const WorkflowDef = z
  .object({
    key,
    label: z.string().trim().min(1).max(40),
    plural: z.string().trim().min(1).max(40),
    initial: key,
    /** Records carry an optional due date; overdue = past it and not in a final state. */
    dueDate: z.boolean(),
    /** Roles that may create records ("*" = any member). */
    createRoles: z.array(z.string().min(1).max(24)).min(1).max(10),
    states: z
      .array(
        z.object({
          key,
          label: z.string().trim().min(1).max(40),
          /** Flag a record as stuck after this many hours in the state; null = never. */
          limitHours: z
            .number()
            .positive()
            .max(24 * 365)
            .nullable(),
          final: z.boolean(),
        }),
      )
      .min(2)
      .max(20),
    transitions: z
      .array(
        z.object({
          from: z.array(key).min(1).max(20),
          to: key,
          label: z.string().trim().min(1).max(40),
          /** Role keys, "creator" or "*". */
          roles: z.array(z.string().min(1).max(24)).min(1).max(10),
        }),
      )
      .min(1)
      .max(60),
  })
  .superRefine((w, ctx) => {
    const states = w.states.map((s) => s.key);
    if (new Set(states).size !== states.length)
      ctx.addIssue({ code: "custom", path: ["states"], message: "state keys must be unique" });
    if (!states.includes(w.initial))
      ctx.addIssue({ code: "custom", path: ["initial"], message: `unknown state ${w.initial}` });
    w.transitions.forEach((t, i) => {
      for (const s of [...t.from, t.to])
        if (!states.includes(s))
          ctx.addIssue({ code: "custom", path: ["transitions", i], message: `unknown state ${s}` });
    });
  });

export const WorkflowParams = z
  .object({ workflows: z.array(WorkflowDef).min(1).max(10) })
  .superRefine((p, ctx) => {
    const keys = p.workflows.map((w) => w.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        path: ["workflows"],
        message: "workflow keys must be unique",
      });
  });

export type Workflow = z.infer<typeof WorkflowDef>;
export type WorkflowConfig = z.infer<typeof WorkflowParams>;

export const workflowConfig: WorkflowConfig = WorkflowParams.parse(params);

export function workflowOf(key: string, cfg: WorkflowConfig = workflowConfig): Workflow | null {
  return cfg.workflows.find((w) => w.key === key) ?? null;
}

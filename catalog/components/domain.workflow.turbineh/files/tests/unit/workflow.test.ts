import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowDef, WorkflowParams } from "@/workflow/config";
import {
  allowedTransitions,
  canCreate,
  isOverdue,
  stuckHours,
  transitionError,
} from "@/workflow/engine";
import params from "@/workflow/params.json";

/** An equipment loan, as a request would describe it (internal-tool, learning round). */
const loan = WorkflowDef.parse({
  key: "loan",
  label: "Loan",
  plural: "Loans",
  initial: "requested",
  dueDate: true,
  createRoles: ["*"],
  states: [
    { key: "requested", label: "Requested", limitHours: 48, final: false },
    { key: "approved", label: "Approved", limitHours: null, final: false },
    { key: "rejected", label: "Rejected", limitHours: null, final: true },
    { key: "out", label: "Out", limitHours: null, final: false },
    { key: "returned", label: "Returned", limitHours: null, final: true },
  ],
  transitions: [
    { from: ["requested"], to: "approved", label: "Approve", roles: ["manager"] },
    { from: ["requested"], to: "rejected", label: "Reject", roles: ["manager"] },
    { from: ["requested"], to: "rejected", label: "Withdraw", roles: ["creator"] },
    { from: ["approved"], to: "out", label: "Hand out", roles: ["manager"] },
    { from: ["out"], to: "returned", label: "Check in", roles: ["manager"] },
  ],
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("workflow (domain.workflow.turbineh)", () => {
  it("ships a valid workflow definition and rejects inconsistent ones", () => {
    expect(WorkflowParams.safeParse(params).success).toBe(true);
    const broken = {
      ...loan,
      transitions: [{ from: ["requested"], to: "lost", label: "x", roles: ["*"] }],
    };
    expect(WorkflowDef.safeParse(broken).success).toBe(false);
    expect(WorkflowDef.safeParse({ ...loan, initial: "nowhere" }).success).toBe(false);
  });

  it("offers only the transitions of the current state that the person's role allows", () => {
    const manager = { role: "manager", isCreator: false };
    const borrower = { role: "member", isCreator: true };
    const other = { role: "member", isCreator: false };
    expect(allowedTransitions(loan, "requested", manager).map((t) => t.to)).toEqual([
      "approved",
      "rejected",
    ]);
    expect(allowedTransitions(loan, "requested", borrower).map((t) => t.label)).toEqual([
      "Withdraw",
    ]);
    expect(allowedTransitions(loan, "requested", other)).toEqual([]);
    expect(allowedTransitions(loan, "returned", manager)).toEqual([]);
  });

  it("refuses transitions the workflow does not define, from final states, or by the wrong role", () => {
    const manager = { role: "manager", isCreator: false };
    expect(transitionError(loan, "requested", "approved", manager)).toBeNull();
    expect(transitionError(loan, "requested", "returned", manager)).toMatch(
      /cannot go from Requested to Returned/,
    );
    expect(transitionError(loan, "returned", "out", manager)).toMatch(/cannot go/);
    expect(
      transitionError(loan, "requested", "approved", { role: "member", isCreator: true }),
    ).toMatch(/Your role cannot/);
    expect(transitionError(loan, "requested", "teleported", manager)).toMatch(/Unknown state/);
    expect(canCreate(loan, "member")).toBe(true);
  });

  it("flags a record stuck longer than its state's limit, and overdue records", () => {
    const since = new Date("2026-10-10T08:00:00Z");
    expect(stuckHours(loan, "requested", since, new Date("2026-10-11T08:00:00Z"))).toBeNull();
    expect(stuckHours(loan, "requested", since, new Date("2026-10-12T09:00:00Z"))).toBe(49);
    expect(stuckHours(loan, "approved", since, new Date("2027-01-01T00:00:00Z"))).toBeNull();
    const due = new Date("2026-10-12T23:59:59Z");
    expect(isOverdue(loan, "out", due, new Date("2026-10-13T08:00:00Z"))).toBe(true);
    expect(isOverdue(loan, "returned", due, new Date("2026-10-13T08:00:00Z"))).toBe(false);
    expect(isOverdue(loan, "out", null, new Date("2026-10-13T08:00:00Z"))).toBe(false);
  });

  it("keeps history immutable: no code updates or deletes it and the database refuses it", () => {
    const offenders = sources("src").filter((f) =>
      /\.(update|delete)\(\s*workflowEvents\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(readFileSync("src/db/sql/110-workflow-history-append-only.sql", "utf8")).toMatch(
      /BEFORE UPDATE OR DELETE ON workflow_events/,
    );
  });
});

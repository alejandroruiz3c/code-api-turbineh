import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditParams } from "@/audit/config";
import { defaultSummary, diffChanges, REDACTED } from "@/audit/diff";
import params from "@/audit/params.json";

const opts = { redact: ["password", "token"], ignore: ["id", "organizationId", "updatedAt"] };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("audit log (domain.audit-log.turbineh)", () => {
  it("records only the fields that changed, with before and after values", () => {
    const before = { id: "1", title: "Interview", tags: "ux", updatedAt: new Date(1) };
    const after = { id: "1", title: "Interview #2", tags: "ux", updatedAt: new Date(2) };
    expect(diffChanges(before, after, opts)).toEqual([
      { field: "title", before: "Interview", after: "Interview #2" },
    ]);
    expect(diffChanges(null, { title: "New", body: null }, opts)).toEqual([
      { field: "title", before: null, after: "New" },
    ]);
    expect(diffChanges({ title: "Gone" }, null, opts)).toEqual([
      { field: "title", before: "Gone", after: null },
    ]);
    expect(defaultSummary("note.updated", [{ field: "title", before: "a", after: "b" }])).toBe(
      "note.updated (title)",
    );
  });

  it("never stores sensitive values (passwords, tokens) in the log", () => {
    const changes = diffChanges(
      { passwordHash: "x1" },
      { passwordHash: "x2", apiToken: "t" },
      opts,
    );
    expect(changes.every((c) => c.after === REDACTED)).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/x2|"t"/);
  });

  it("is append-only: no code updates or deletes audit entries and the database refuses it", () => {
    const offenders = sources("src").filter((f) =>
      /\.(update|delete)\(\s*auditEvents\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    const sql = readFileSync("src/db/sql/100-audit-append-only.sql", "utf8");
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON audit_events/);
  });

  it("ships valid parameters", () => {
    expect(AuditParams.safeParse(params).success).toBe(true);
  });
});

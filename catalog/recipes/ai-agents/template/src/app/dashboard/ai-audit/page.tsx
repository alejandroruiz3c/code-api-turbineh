import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { aiAudit } from "@/db/schema";
import { can, requireMember } from "@/server/authz";

/** Audit of AI calls (AI Safety Pack): who, what for, route, flags and outcome — never the content. Admins only. */
export default async function AiAudit() {
  const ctx = await requireMember();
  if (!can(ctx.role, "update")) notFound();
  const rows = await db
    .select()
    .from(aiAudit)
    .where(eq(aiAudit.organizationId, ctx.organizationId))
    .orderBy(desc(aiAudit.createdAt))
    .limit(100);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">AI audit</h1>
      <p className="text-sm text-slate-600">
        Every AI request of the workspace. Content is not stored here: only its size and a
        fingerprint.
      </p>
      <Table head={["When", "Purpose", "Route", "Status", "Flags", "Characters"]}>
        {rows.map((r) => (
          <tr key={r.id} data-status={r.status}>
            <td className="px-3 py-2">
              {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </td>
            <td className="px-3 py-2">{r.purpose}</td>
            <td className="px-3 py-2">{r.route ?? "—"}</td>
            <td className="px-3 py-2">{r.status}</td>
            <td className="px-3 py-2">{r.flags || "—"}</td>
            <td className="px-3 py-2">{r.inputChars}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

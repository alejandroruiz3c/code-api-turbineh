import { and, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { byUrgency, isOverdue, isStatus, STATUS_LABEL } from "@/server/board";

/** Tasks assigned to the signed-in user across projects. */
export default async function MyTasks() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      project: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.organizationId, ctx.organizationId),
        eq(tasks.assigneeId, ctx.userId),
        ne(tasks.status, "done"),
      ),
    );
  rows.sort(byUrgency);
  return (
    <Card title={`My tasks (${rows.length})`}>
      <Table head={["Task", "Project", "Status", "Priority", "Due"]}>
        {rows.map((t) => {
          const s = isStatus(t.status) ? t.status : "todo";
          const overdue = isOverdue(t.dueDate, s);
          return (
            <tr key={t.id} className="border-b border-line">
              <td className="px-3 py-2">
                <Link className="underline" href={`/dashboard/tasks/${t.id}`}>
                  {t.title}
                </Link>
              </td>
              <td className="px-3 py-2">{t.project}</td>
              <td className="px-3 py-2">{STATUS_LABEL[s]}</td>
              <td className="px-3 py-2">{t.priority}</td>
              <td className={`px-3 py-2 ${overdue ? "font-semibold text-danger" : ""}`}>
                {t.dueDate ? `${overdue ? "Overdue · " : ""}${t.dueDate}` : "—"}
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

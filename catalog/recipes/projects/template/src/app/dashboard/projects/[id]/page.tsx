import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { isOverdue, isStatus, neighbour, PRIORITIES, STATUSES, STATUS_LABEL } from "@/server/board";
import { workspaceMembers } from "@/server/members";
import { createTask, moveTask } from "../actions";

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-50 text-blue-800",
  high: "bg-amber-50 text-amber-800",
  urgent: "bg-red-50 text-red-800",
};

export default async function Board({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.organizationId, ctx.organizationId)));
  if (!project) notFound();
  const [rows, members] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(asc(tasks.position)),
    workspaceMembers(),
  ]);
  const name = (uid: string | null) => members.find((m) => m.userId === uid)?.name ?? "Unassigned";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/projects" className="text-sm underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
        {project.description ? <p className="text-slate-600">{project.description}</p> : null}
      </div>
      <Card title="New task">
        <form action={createTask} className="grid gap-3 md:grid-cols-5 md:items-end">
          <input type="hidden" name="projectId" value={project.id} />
          <div className="md:col-span-2">
            <Label htmlFor="t-title">Task</Label>
            <Input id="t-title" name="title" required maxLength={200} />
          </div>
          <div>
            <Label htmlFor="t-assignee">Assignee</Label>
            <select
              id="t-assignee"
              name="assigneeId"
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              defaultValue={ctx.userId}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="t-priority">Priority</Label>
            <select
              id="t-priority"
              name="priority"
              defaultValue="medium"
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="t-due">Due date</Label>
            <Input id="t-due" name="dueDate" type="date" />
          </div>
          <div className="md:col-span-5">
            <Button type="submit">Add task</Button>
          </div>
        </form>
      </Card>
      <div className="grid gap-4 md:grid-cols-4" role="list" aria-label="Board">
        {STATUSES.map((status) => {
          const column = rows.filter((t) => t.status === status);
          return (
            <section
              key={status}
              role="listitem"
              aria-labelledby={`col-${status}`}
              className="rounded-lg bg-slate-100 p-3"
            >
              <h2 id={`col-${status}`} className="mb-3 text-sm font-semibold">
                {STATUS_LABEL[status]} <span className="text-slate-500">({column.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {column.map((t) => {
                  const s = isStatus(t.status) ? t.status : "todo";
                  const overdue = isOverdue(t.dueDate, s);
                  return (
                    <li
                      key={t.id}
                      className="rounded-md bg-white p-3 shadow-sm"
                      data-task={t.title}
                    >
                      <Link
                        href={`/dashboard/tasks/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 ${PRIORITY_STYLE[t.priority] ?? ""}`}
                        >
                          {t.priority}
                        </span>
                        <span className="text-slate-600">{name(t.assigneeId)}</span>
                        {t.dueDate ? (
                          <span
                            className={overdue ? "font-semibold text-red-600" : "text-slate-500"}
                          >
                            {overdue ? "Overdue · " : ""}
                            {t.dueDate}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex justify-between text-xs">
                        {neighbour(s, -1) ? (
                          <form action={moveTask}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="dir" value="-1" />
                            <button
                              type="submit"
                              className="underline"
                              aria-label={`Move ${t.title} to ${STATUS_LABEL[neighbour(s, -1) ?? "todo"]}`}
                            >
                              ←
                            </button>
                          </form>
                        ) : (
                          <span />
                        )}
                        {neighbour(s, 1) ? (
                          <form action={moveTask}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="dir" value="1" />
                            <button
                              type="submit"
                              className="underline"
                              aria-label={`Move ${t.title} to ${STATUS_LABEL[neighbour(s, 1) ?? "done"]}`}
                            >
                              →
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

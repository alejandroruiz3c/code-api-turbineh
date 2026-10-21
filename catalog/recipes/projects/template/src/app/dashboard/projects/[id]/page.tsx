import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import {
  isOverdue,
  isStatus,
  neighbour,
  PRIORITIES,
  splitArchived,
  STATUSES,
  STATUS_LABEL,
} from "@/server/board";
import { workspaceMembers } from "@/server/members";
import { setTaskArchived } from "../../tasks/actions";
import { createTask, deleteProject, moveTask, setProjectArchived, updateProject } from "../actions";

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-subtle text-muted",
  medium: "bg-info-soft text-info",
  high: "bg-warning-soft text-warning",
  urgent: "bg-danger-soft text-danger",
};

/** One project's kanban board (move tasks between columns), its settings and its archived tasks. */
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
  const { active, archived } = splitArchived(rows);
  const name = (uid: string | null) => members.find((m) => m.userId === uid)?.name ?? "Unassigned";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/projects" className="text-sm underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
        {project.archived ? <p className="text-sm text-warning">Archived project</p> : null}
        {project.description ? <p className="text-muted">{project.description}</p> : null}
      </div>
      <Card title="Project settings">
        <form action={updateProject} className="flex flex-col gap-3 md:flex-row md:items-end">
          <input type="hidden" name="id" value={project.id} />
          <div className="flex-1">
            <Label htmlFor="p-name">Project name</Label>
            <Input id="p-name" name="name" defaultValue={project.name} required maxLength={120} />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-desc">Project description</Label>
            <Input
              id="p-desc"
              name="description"
              defaultValue={project.description}
              maxLength={2000}
            />
          </div>
          <Button type="submit">Save project</Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <form action={setProjectArchived}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="action" value={project.archived ? "restore" : "archive"} />
            <button type="submit" className="underline">
              {project.archived ? "Restore project" : "Archive project"}
            </button>
          </form>
          {can(ctx.role, "delete") ? (
            <form action={deleteProject}>
              <input type="hidden" name="id" value={project.id} />
              <button type="submit" className="text-danger underline">
                Delete project and its tasks
              </button>
            </form>
          ) : null}
        </div>
      </Card>
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
              className="w-full rounded-md border border-field px-2 py-2 text-sm"
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
              className="w-full rounded-md border border-field px-2 py-2 text-sm"
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
          const column = active.filter((t) => t.status === status);
          return (
            <section
              key={status}
              role="listitem"
              aria-labelledby={`col-${status}`}
              className="rounded-lg bg-subtle p-3"
            >
              <h2 id={`col-${status}`} className="mb-3 text-sm font-semibold">
                {STATUS_LABEL[status]} <span className="text-muted">({column.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {column.map((t) => {
                  const s = isStatus(t.status) ? t.status : "todo";
                  const overdue = isOverdue(t.dueDate, s);
                  return (
                    <li
                      key={t.id}
                      className="rounded-md bg-panel p-3 shadow-sm"
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
                        <span className="text-muted">{name(t.assigneeId)}</span>
                        {t.dueDate ? (
                          <span className={overdue ? "font-semibold text-danger" : "text-muted"}>
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
      {archived.length > 0 ? (
        <section aria-labelledby="archived-tasks" className="flex flex-col gap-2">
          <h2 id="archived-tasks" className="text-lg font-semibold">
            Archived tasks
          </h2>
          <ul className="flex flex-col gap-2" aria-label="Archived tasks">
            {archived.map((t) => (
              <li
                key={t.id}
                data-archived-task={t.title}
                className="flex items-center justify-between rounded-md border border-line p-3"
              >
                <Link href={`/dashboard/tasks/${t.id}`} className="hover:underline">
                  {t.title}
                </Link>
                <form action={setTaskArchived}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="action" value="restore" />
                  <button
                    type="submit"
                    className="text-sm underline"
                    aria-label={`Restore ${t.title}`}
                  >
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { taskComments, tasks } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { PRIORITIES, STATUSES, STATUS_LABEL } from "@/server/board";
import { workspaceMembers } from "@/server/members";
import { addComment, deleteTask, updateTask } from "../actions";

const field = "w-full rounded-md border border-slate-300 px-2 py-2 text-sm";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, ctx.organizationId)));
  if (!task) notFound();
  const [comments, members] = await Promise.all([
    db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt)),
    workspaceMembers(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <Link href={`/dashboard/projects/${task.projectId}`} className="text-sm underline">
        ← Board
      </Link>
      <Card title="Task">
        <form action={updateTask} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={task.id} />
          <div className="md:col-span-2">
            <Label htmlFor="e-title">Title</Label>
            <Input id="e-title" name="title" defaultValue={task.title} required maxLength={200} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="e-desc">Description</Label>
            <textarea
              id="e-desc"
              name="description"
              defaultValue={task.description}
              rows={5}
              className={field}
            />
          </div>
          <div>
            <Label htmlFor="e-status">Status</Label>
            <select id="e-status" name="status" defaultValue={task.status} className={field}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="e-priority">Priority</Label>
            <select id="e-priority" name="priority" defaultValue={task.priority} className={field}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="e-assignee">Assignee</Label>
            <select
              id="e-assignee"
              name="assigneeId"
              defaultValue={task.assigneeId ?? ""}
              className={field}
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
            <Label htmlFor="e-due">Due date</Label>
            <Input id="e-due" name="dueDate" type="date" defaultValue={task.dueDate ?? ""} />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Save task</Button>
          </div>
        </form>
        {can(ctx.role, "delete") ? (
          <form action={deleteTask} className="mt-4">
            <input type="hidden" name="id" value={task.id} />
            <button type="submit" className="text-sm text-red-600 underline">
              Delete task
            </button>
          </form>
        ) : null}
      </Card>
      <Card title={`Comments (${comments.length})`}>
        <ul className="mb-4 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-slate-500">
                {c.authorName} · {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
        <form action={addComment} className="flex flex-col gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          <Label htmlFor="c-body">Add a comment</Label>
          <textarea id="c-body" name="body" required maxLength={5000} rows={3} className={field} />
          <div>
            <Button type="submit">Comment</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

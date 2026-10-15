import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { createProject } from "./actions";

/** Projects of the workspace: list and create. */
export default async function Projects() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      open: count(tasks.id),
    })
    .from(projects)
    .leftJoin(tasks, and(eq(tasks.projectId, projects.id), eq(tasks.status, "todo")))
    .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.archived, 0)))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <Card title="New project">
        <form action={createProject} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Label htmlFor="pj-name">Name</Label>
            <Input id="pj-name" name="name" required maxLength={120} />
          </div>
          <div className="flex-1">
            <Label htmlFor="pj-desc">Description</Label>
            <Input id="pj-desc" name="description" maxLength={2000} />
          </div>
          <Button type="submit">Create project</Button>
        </form>
      </Card>
      <ul className="grid gap-4 md:grid-cols-3">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border border-line bg-panel p-5">
            <Link
              href={`/dashboard/projects/${p.id}`}
              className="text-lg font-semibold hover:underline"
            >
              {p.name}
            </Link>
            <p className="mt-1 text-sm text-muted">{p.description}</p>
            <p className="mt-3 text-xs text-muted">{p.open} to do</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

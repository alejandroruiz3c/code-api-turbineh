import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { splitArchived } from "@/server/board";
import { createProject, setProjectArchived } from "./actions";

/** Projects of the workspace: list and create; archived projects are listed apart and can be restored. */
export default async function Projects() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      archived: projects.archived,
      open: count(tasks.id),
    })
    .from(projects)
    .leftJoin(
      tasks,
      and(eq(tasks.projectId, projects.id), eq(tasks.status, "todo"), eq(tasks.archived, 0)),
    )
    .where(eq(projects.organizationId, ctx.organizationId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
  const { active, archived } = splitArchived(rows);
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
      <ul className="grid gap-4 md:grid-cols-3" aria-label="Projects">
        {active.map((p) => (
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
      {archived.length > 0 ? (
        <section aria-labelledby="archived-projects" className="flex flex-col gap-3">
          <h2 id="archived-projects" className="text-lg font-semibold">
            Archived projects
          </h2>
          <ul className="flex flex-col gap-2" aria-label="Archived projects">
            {archived.map((p) => (
              <li
                key={p.id}
                data-archived-project={p.name}
                className="flex items-center justify-between rounded-md border border-line p-3"
              >
                <Link href={`/dashboard/projects/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
                <form action={setProjectArchived}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="action" value="restore" />
                  <button
                    type="submit"
                    className="text-sm underline"
                    aria-label={`Restore ${p.name}`}
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

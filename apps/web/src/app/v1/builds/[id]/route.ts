import { findImprovement, getBuild } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";
import { storage } from "@/server/storage";

const UUID = /^[0-9a-f-]{36}$/;

/** GET /v1/builds/{id} — status, metrics, artefact links, repository URL and feedback. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (!UUID.test(id)) return problem(404, "Build not found");
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) return problem(404, "Build not found");
  const improvement = build.options.mode === "improve" ? null : await findImprovement(db, id, caller.ownerId);
  const a = build.artifact as {
    zipKey?: string;
    bundleKey?: string;
    files?: string[];
    docs?: Record<string, string>;
    slug?: string;
    previews?: { name: string; key: string }[];
  } | null;
  return Response.json({
    id: build.id,
    status: build.status,
    prompt: build.prompt,
    created_at: build.created_at,
    finished_at: build.finished_at,
    error: build.error,
    spec: build.spec,
    metrics: build.metrics,
    repo_url: build.repo_url,
    improved_from: build.options.mode === "improve" ? (build.options.parent ?? null) : null,
    improvement_build_id: improvement?.id ?? null,
    artifact: a?.zipKey
      ? {
          slug: a.slug,
          zip_url: await storage.url(a.zipKey),
          bundle_url: a.bundleKey ? await storage.url(a.bundleKey) : null,
          files: a.files ?? [],
          docs: a.docs ?? {},
          previews: await Promise.all(
            (a.previews ?? []).map(async (p) => ({ name: p.name, url: await storage.url(p.key) })),
          ),
        }
      : null,
  });
}

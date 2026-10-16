import { approvedCatalog, getBuild, type BuildRow } from "@turbineh/db";
import { catalogDocs, ERRORS, flowResult, productError, type CatalogEntry } from "@turbineh/engine";
import type { FlowResult, ProductError } from "@turbineh/shared";
import { getCaller, type Caller } from "./caller";
import { db } from "./db";
import { storage } from "./storage";

/** Product API errors carry the actionable ProductError (PLAN §16.4) inside RFC 9457 problem details. */
export function productProblem(
  status: number,
  error: ProductError,
  /** Extra top-level fields, e.g. the flow `id` of a refused plan so agents can reference it. */
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    // Fields at the top level too, so simple clients read code/message/action directly.
    { type: "about:blank", title: error.message, status, ...error, ...extra, error },
    {
      status,
      headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
    },
  );
}

/** Access token (Bearer or cookie) or an API key; otherwise a 401 with the next step. */
export async function requireCaller(): Promise<Caller | Response> {
  const caller = await getCaller();
  return caller ?? productProblem(401, ERRORS.unauthorized());
}

export const UUID = /^[0-9a-f-]{36}$/;

/**
 * GitHub credentials live in a workspace, so the workspace id must be a secret. With the shared invitation token the
 * id comes from the x-turbineh-workspace header (or the shared "api-default"): only random ids (UUIDs, what the browser
 * cookie and `turbineh init` create) may connect or use GitHub, never guessable names. Accounts and API keys are
 * per-owner already.
 */
export const privateWorkspace = (ownerId: string): boolean =>
  !ownerId.startsWith("invite:") ||
  /^invite:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownerId);

export function githubWorkspaceProblem(caller: Caller): Response | null {
  if (privateWorkspace(caller.ownerId)) return null;
  return productProblem(
    403,
    productError(
      "github_needs_private_workspace",
      "GitHub can only be connected to a private workspace.",
      "Run `turbineh init` in your project (it creates a private workspace id) or send x-turbineh-workspace with a random UUID.",
    ),
  );
}

export async function ownedFlow(caller: Caller, id: string): Promise<BuildRow | Response> {
  const row = UUID.test(id) ? await getBuild(db, id, caller.ownerId) : null;
  return row ?? productProblem(404, ERRORS.notFound("Flow"));
}

let catalogCache: { at: number; rows: CatalogEntry[] } | null = null;
/** Approved components (cached for a minute per instance: the catalog changes only on sync). */
export async function catalog(): Promise<CatalogEntry[]> {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.rows;
  const rows = (await approvedCatalog(db)).map((r) => ({ ...r, docs: catalogDocs(r.docs) }));
  catalogCache = { at: Date.now(), rows };
  return rows;
}

/** FlowResult with signed, short-lived package URLs. */
export async function resultOf(row: BuildRow): Promise<FlowResult> {
  const pkg = (row.artifact?.package ?? null) as { zipKey?: string; manifestKey?: string } | null;
  const [zipUrl, manifestUrl] = await Promise.all([
    pkg?.zipKey ? storage.url(pkg.zipKey) : Promise.resolve(null),
    pkg?.manifestKey ? storage.url(pkg.manifestKey) : Promise.resolve(null),
  ]);
  return flowResult(
    {
      id: row.id,
      status: row.status,
      options: row.options,
      metrics: row.metrics,
      artifact: row.artifact,
      error: row.error,
    },
    { zipUrl, manifestUrl },
  );
}

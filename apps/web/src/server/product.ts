import { approvedCatalog, getBuild, type BuildRow } from "@turbineh/db";
import { ERRORS, flowResult, type CatalogEntry } from "@turbineh/engine";
import type { FlowResult, ProductError } from "@turbineh/shared";
import { getCaller, type Caller } from "./caller";
import { db } from "./db";
import { storage } from "./storage";

/** Product API errors carry the actionable ProductError (PLAN §16.4) inside RFC 9457 problem details. */
export function productProblem(status: number, error: ProductError): Response {
  return Response.json(
    { type: "about:blank", title: error.message, status, error },
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

export async function ownedFlow(caller: Caller, id: string): Promise<BuildRow | Response> {
  const row = UUID.test(id) ? await getBuild(db, id, caller.ownerId) : null;
  return row ?? productProblem(404, ERRORS.notFound("Flow"));
}

let catalogCache: { at: number; rows: CatalogEntry[] } | null = null;
/** Approved components (cached for a minute per instance: the catalog changes only on sync). */
export async function catalog(): Promise<CatalogEntry[]> {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.rows;
  const rows = await approvedCatalog(db);
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

/**
 * `pnpm catalog:sync` — upserts every catalog/components/<id>/component.yaml (git is the source of truth) into the
 * `components` table with an embedding of the component card, and removes rows whose manifest disappeared.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, embedderFromEnv, getPool, toVector } from "@turbineh/db";
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { decisionCard, readDocs } from "@turbineh/catalog";
import { parse } from "yaml";

interface Manifest {
  id: string;
  version: string;
  status: string;
  category: string;
  source: { purl: string };
  license: { detected: string };
  capability: { does: string; does_not: string };
  relations: { provides: string[] };
}

loadLocalEnv();
const env = readEnv();
const db = getPool(env.DATABASE_URL);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../catalog/components");
const manifests = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => parse(readFileSync(join(root, d.name, "component.yaml"), "utf8")) as Manifest);
// Documentation (docs.yaml) travels with the manifest: search, /v1/capabilities and the decider card use it.
for (const m of manifests) {
  const docs = readDocs(join(root, m.id));
  if (docs) (m as Manifest & { docs?: unknown }).docs = docs;
}
const cards = manifests.map((m) => {
  const docs = (m as Manifest & { docs?: Parameters<typeof decisionCard>[0] }).docs;
  return docs
    ? `${m.id}: ${decisionCard(docs, m.relations.provides)}`
    : `${m.id}: ${m.capability.does}. Provides ${m.relations.provides.join(", ")}.`;
});
const vectors = await embedderFromEnv(env).embed(cards);
for (const [i, m] of manifests.entries()) {
  await db.query(
    `INSERT INTO components (id, version, status, category, provides, purl, license, manifest, card, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version, status=EXCLUDED.status, category=EXCLUDED.category,
       provides=EXCLUDED.provides, purl=EXCLUDED.purl, license=EXCLUDED.license, manifest=EXCLUDED.manifest,
       card=EXCLUDED.card, embedding=EXCLUDED.embedding, synced_at=now()`,
    [
      m.id,
      m.version,
      m.status,
      m.category,
      m.relations.provides,
      m.source.purl,
      m.license.detected,
      m,
      cards[i],
      toVector(vectors[i] ?? []),
    ],
  );
}
const removed = await db.query("DELETE FROM components WHERE NOT (id = ANY($1))", [
  manifests.map((m) => m.id),
]);
console.log(`synced ${manifests.length} components, removed ${removed.rowCount ?? 0}`);
await closePool();

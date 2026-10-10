/**
 * `pnpm ingest [--pages N] [--embed]`
 * Seeds the `discovered` layer (PLAN §3.7) from ecosyste.ms npm metadata and, with --embed,
 * computes embeddings for retrieval. Idempotent (upsert by ecosystem + name).
 */
import { join } from "node:path";
import { closePool, embedderFromEnv, getPool, toVector } from "@turbineh/db";
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { fetchPage, packageCard, type EcosystemsPackage } from "./ecosystems.js";

const args = process.argv.slice(2);
const pages = Number(args[args.indexOf("--pages") + 1] ?? 0) || 60;
const embed = args.includes("--embed");

loadLocalEnv();
const env = readEnv();
const db = getPool(env.DATABASE_URL);
const opts = {
  cacheDir: join(process.cwd(), ".cache"),
  userAgent: "code-api-turbineh-ingest (alex.ruiz@turbineh.com)",
};

async function upsert(rows: EcosystemsPackage[]): Promise<number> {
  let n = 0;
  for (const p of rows) {
    if (!p.name || p.status === "removed") continue;
    const license = p.normalized_licenses?.[0] ?? p.licenses ?? null;
    await db.query(
      `INSERT INTO packages (ecosystem, name, latest_version, description, keywords, license, repository_url, homepage,
         downloads, dependents, latest_release_at, advisories, source, metadata)
       VALUES ('npm',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ecosyste.ms',$12)
       ON CONFLICT (ecosystem, name) DO UPDATE SET
         latest_version=EXCLUDED.latest_version, description=EXCLUDED.description, keywords=EXCLUDED.keywords,
         license=EXCLUDED.license, repository_url=EXCLUDED.repository_url, homepage=EXCLUDED.homepage,
         downloads=EXCLUDED.downloads, dependents=EXCLUDED.dependents, latest_release_at=EXCLUDED.latest_release_at,
         advisories=EXCLUDED.advisories, metadata=EXCLUDED.metadata, ingested_at=now()`,
      [
        p.name,
        p.latest_release_number,
        p.description,
        p.keywords_array ?? [],
        license,
        p.repository_url,
        p.homepage,
        p.downloads,
        p.dependent_packages_count,
        p.latest_release_published_at,
        p.advisories?.length ?? 0,
        { purl: p.purl },
      ],
    );
    n++;
  }
  return n;
}

let total = 0;
for (const sort of ["downloads", "dependent_packages_count"] as const) {
  for (let page = 1; page <= pages; page++) {
    total += await upsert(await fetchPage({ sort, page }, opts));
  }
}
const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM packages");
console.log(`upserted ${total} rows; packages in catalog: ${rows[0]?.n}`);

if (embed) {
  const embedder = embedderFromEnv(env);
  for (;;) {
    const pending = await db.query<{
      id: string;
      name: string;
      description: string | null;
      keywords: string[];
    }>(
      "SELECT id, name, description, keywords FROM packages WHERE embedding IS NULL ORDER BY downloads DESC NULLS LAST LIMIT 512",
    );
    if (pending.rows.length === 0) break;
    const vectors = await embedder.embed(
      pending.rows.map((r) =>
        packageCard({
          name: r.name,
          description: r.description,
          keywords_array: r.keywords,
        } as EcosystemsPackage),
      ),
    );
    for (const [i, r] of pending.rows.entries()) {
      await db.query("UPDATE packages SET embedding = $1 WHERE id = $2", [
        toVector(vectors[i] ?? []),
        r.id,
      ]);
    }
    process.stdout.write(`embedded +${pending.rows.length}\n`);
  }
}
await closePool();

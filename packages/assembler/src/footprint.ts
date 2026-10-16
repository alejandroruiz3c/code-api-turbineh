import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { DeliveryManifest, Footprint } from "@turbineh/shared";
import { readOwners } from "./ownership.js";
import type { TreeShakeResult } from "./modules.js";

const CODE = new Set([".ts", ".tsx", ".mjs", ".css"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Footprint (ADR-0064, audit F-05): the share of the app's source lines (src/) that no criterion of the request and no
 * transversal requirement links to. A file is linked through its owner (.turbineh/owners.json): generated code comes
 * from the request; the recipe templates are the covered use case and its transversal requirements (their optional
 * modules were already removed when nothing asked for them); a catalogue component is linked when the delivery
 * manifest justifies it. Code with no recorded owner counts as unlinked.
 */
export function footprintOf(
  outDir: string,
  manifest: DeliveryManifest,
  removed: TreeShakeResult["removed"] = [],
): Footprint {
  const owners = readOwners(outDir);
  const justified = new Set(
    manifest.entries
      .filter((e) => e.component && e.justifiedBy.length > 0)
      .map((e) => e.component as string),
  );
  const linked = (owner: string | undefined) => {
    if (!owner) return false;
    const [kind, id = ""] = [
      owner.slice(0, owner.indexOf(":")) || owner,
      owner.slice(owner.indexOf(":") + 1),
    ];
    if (kind === "component") return justified.has(id);
    return true;
  };
  let lines = 0;
  let unlinkedLines = 0;
  const unlinked: Footprint["unlinkedFiles"] = [];
  for (const file of walk(join(outDir, "src"))) {
    if (!CODE.has(extname(file))) continue;
    const rel = relative(outDir, file);
    const n = readFileSync(file, "utf8").split("\n").length;
    lines += n;
    const owner = owners[rel];
    if (!linked(owner)) {
      unlinkedLines += n;
      unlinked.push({ path: rel, lines: n, owner: owner ?? "unknown" });
    }
  }
  const delivered = new Set(
    manifest.entries
      .filter((e) => e.component && e.status !== "not_delivered")
      .map((e) => e.component as string),
  );
  return {
    lines,
    unlinkedLines,
    share: lines > 0 ? Math.round((unlinkedLines / lines) * 1000) / 1000 : 0,
    unlinkedComponents: [...delivered].filter((id) => !justified.has(id)),
    unlinkedFiles: unlinked.sort((a, b) => b.lines - a.lines).slice(0, 20),
    removedModules: removed.map((r) => ({
      module: `${r.owner}/${r.module}`,
      files: r.files,
      lines: r.lines,
    })),
  };
}

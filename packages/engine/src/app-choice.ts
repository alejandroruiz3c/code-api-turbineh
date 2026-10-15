import type { Decider } from "@turbineh/decider";
import { pickAppPath } from "./repo-analysis.js";

/**
 * Which app of a monorepo receives the capability (ADR-0039 amendment, owner decision 2026-10-13). When the person
 * chose, that is it. With one candidate the answer is code. With several Next.js apps the decider chooses, through the
 * resource decision engine (ADR-0058), because the path heuristic picks the marketing site over the product app. When
 * the engine has no confident answer, on any error, or without a decider, the deterministic heuristic (`pickAppPath`)
 * decides. Database and authentication strategy stay in code (`analysisFindings`).
 */

/** The decider (type only: the engine and the CLI bundle never load a decision backend). */
export type AppChoiceDecider = Pick<Decider, "chooseApp">;

export interface AppChoice {
  appPath: string;
  by: "person" | "code" | "decider";
  /** The decider's calibrated confidence when it was asked. */
  confidence?: number;
  /** Next.js apps found (the decider's options). */
  candidates: string[];
}

const parse = (text: string | undefined): Record<string, unknown> | null => {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const depsOf = (text: string | undefined): string[] => {
  const p = parse(text);
  return Object.keys({
    ...((p?.devDependencies as Record<string, string> | undefined) ?? {}),
    ...((p?.dependencies as Record<string, string> | undefined) ?? {}),
  });
};

/** Next.js apps of the repository ("" = root), from the package.json files read in the first phase. */
export function appCandidates(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((p) => /(^|\/)package\.json$/.test(p))
    .map((p) => (p === "package.json" ? "" : p.slice(0, -"/package.json".length)))
    .filter((dir) => depsOf(files[dir ? `${dir}/package.json` : "package.json"]).includes("next"))
    .sort();
}

export async function chooseAppPath(
  files: Record<string, string>,
  opts: { preferred?: string; decider?: AppChoiceDecider | null; need?: string } = {},
): Promise<AppChoice> {
  const candidates = appCandidates(files);
  const fallback = pickAppPath(files, opts.preferred);
  if (opts.preferred !== undefined && fallback === opts.preferred)
    return { appPath: fallback, by: "person", candidates };
  if (candidates.length < 2 || !opts.decider) return { appPath: fallback, by: "code", candidates };
  const a = await opts.decider
    .chooseApp({
      apps: candidates.map((dir) => ({
        dir,
        dependencies: depsOf(files[dir ? `${dir}/package.json` : "package.json"]),
      })),
      ...(opts.need !== undefined ? { need: opts.need } : {}),
    })
    .catch(() => null);
  if (!a?.accepted || a.dir === null || !candidates.includes(a.dir))
    return {
      appPath: fallback,
      by: "code",
      candidates,
      ...(a && a.dir !== null ? { confidence: a.confidence } : {}),
    };
  return { appPath: a.dir, by: "decider", confidence: a.confidence, candidates };
}

import type { Decider } from "@turbineh/decider";
import { pickAppPath } from "./repo-analysis.js";

/**
 * Which app of a monorepo receives the capability (ADR-0039 amendment, owner decision 2026-10-13). When the person
 * chose, that is it. With one candidate the answer is code. With several Next.js apps the decider chooses — one Choice
 * over the apps, described by their dependencies — because the path heuristic picks the marketing site over the
 * product app (measured 17/20 vs 20/20 on bench/agent-decisions/adaptation.ts). Below the confidence threshold, or
 * without a decider, or on any decider error, the deterministic heuristic (`pickAppPath`) decides. Database and
 * authentication strategy stay in code (`analysisFindings`).
 */

/** The decider (type only: the engine and the CLI bundle never load the decider SDK). */
export type AppChoiceDecider = Pick<Decider, "ask">;

export interface AppChoice {
  appPath: string;
  by: "person" | "code" | "decider";
  /** The decider's calibrated confidence when it was asked. */
  confidence?: number;
  /** Next.js apps found (the decider's options). */
  candidates: string[];
}

/** At or above this confidence the decider's choice is used; below it the heuristic decides. Policy lives in code. */
export const APP_CHOICE_CONFIDENCE = 0.5;

const DEFAULT_NEED =
  "A capability with Next.js App Router pages and server code; it reuses the project's PostgreSQL database and its sign-in when the app has them.";

const ROOT = "root";
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
  const label = (dir: string) => dir || ROOT;
  const d = await opts.decider
    .ask(
      {
        capability: (opts.need ?? DEFAULT_NEED).slice(0, 1500),
        project_apps: candidates.map((dir) => ({
          dir: dir || "(repository root)",
          dependencies: depsOf(files[dir ? `${dir}/package.json` : "package.json"]).slice(0, 60),
        })),
      },
      {
        app: {
          type: "choice",
          instructions:
            "Which app of the project should receive the capability: the one whose users and data it serves (for example the product app with the database and sign-in, not a marketing site or docs)?",
          criteria: Object.fromEntries(
            candidates.map((dir) => [label(dir), `The app at ${dir || "the repository root"}.`]),
          ),
        },
      },
    )
    .catch(() => null);
  const a = d?.answers.app;
  const picked = a?.type === "choice" ? (a.choice === ROOT ? "" : a.choice) : null;
  const confidence = a?.type === "choice" ? a.confidence : 0;
  if (picked === null || !candidates.includes(picked) || confidence < APP_CHOICE_CONFIDENCE)
    return {
      appPath: fallback,
      by: "code",
      candidates,
      ...(picked !== null ? { confidence } : {}),
    };
  return { appPath: picked, by: "decider", confidence, candidates };
}

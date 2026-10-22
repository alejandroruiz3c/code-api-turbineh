/**
 * Deterministic matching (component domain.matching.turbineh): scores records (opportunities, tenders, grants…)
 * against an organization's profile — sectors, business activities, geographic coverage and interest keywords — with
 * fixed weights. No model, no randomness: the same profile and records always give the same matches, in the same
 * order, each with the reasons that produced its score.
 */

export interface MatchingProfile {
  sectors: readonly string[];
  activities: readonly string[];
  regions: readonly string[];
  keywords: readonly string[];
}

export interface MatchCandidate {
  id: string;
  title: string;
  description: string;
  sector: string | null;
  activity: string | null;
  region: string | null;
  /** YYYY-MM-DD or null (no deadline). */
  deadline: string | null;
  status: string;
}

export interface Weights {
  sectors: number;
  activities: number;
  regions: number;
  keywords: number;
}

export type Dimension = "sector" | "activity" | "region" | "keyword";

export interface MatchReason {
  dimension: Dimension;
  /** The profile term that matched, as the organization wrote it. */
  term: string;
  points: number;
}

export interface Match<T extends MatchCandidate = MatchCandidate> {
  record: T;
  score: number;
  reasons: MatchReason[];
}

/** Lower case, accents removed, anything that is not a letter or a digit becomes a single space. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Profile terms as typed (comma or new line separated), trimmed, without duplicates (compared normalised). */
export function parseTerms(raw: string, max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const term = part.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = normalize(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** Whether `term` appears in `text` as whole words ("solar" matches "Solar farms", never "solarium"). */
export function containsTerm(text: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  return ` ${normalize(text)} `.includes(` ${t} `);
}

const LABEL: Record<Dimension, string> = {
  sector: "sector",
  activity: "activity",
  region: "region",
  keyword: "keyword",
};

/** "sector: renewable energy" — the why of a match, in words. */
export const reasonText = (r: MatchReason): string => `${LABEL[r.dimension]}: ${r.term}`;

/**
 * The score of one record against the profile: each profile term found adds its dimension's weight once —
 * sectors in the record's sector, activities in its activity, regions in its region, keywords anywhere in its title,
 * description, sector or activity.
 */
export function scoreRecord(
  profile: MatchingProfile,
  record: MatchCandidate,
  weights: Weights,
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  const check = (
    dimension: Dimension,
    terms: readonly string[],
    text: string | null,
    w: number,
  ) => {
    if (!text || w <= 0) return;
    for (const term of terms)
      if (containsTerm(text, term)) reasons.push({ dimension, term, points: w });
  };
  check("sector", profile.sectors, record.sector, weights.sectors);
  check("activity", profile.activities, record.activity, weights.activities);
  check("region", profile.regions, record.region, weights.regions);
  check(
    "keyword",
    profile.keywords,
    [record.title, record.description, record.sector ?? "", record.activity ?? ""].join(" \n "),
    weights.keywords,
  );
  return { score: reasons.reduce((s, r) => s + r.points, 0), reasons };
}

/** Whether a record can still be acted on: open and not past its deadline (`today` is YYYY-MM-DD). */
export function isLive(
  record: Pick<MatchCandidate, "status" | "deadline">,
  today: string,
): boolean {
  return record.status === "open" && (record.deadline === null || record.deadline >= today);
}

/**
 * The matches of a profile, best first: live records whose score reaches `minScore` (and is above zero), excluding
 * `hidden` ids (marked not relevant). Ties are broken by the nearest deadline (none last), then by id.
 */
export function matchRecords<T extends MatchCandidate>(
  profile: MatchingProfile,
  records: readonly T[],
  opts: { weights: Weights; minScore: number; today: string; hidden?: ReadonlySet<string> },
): Match<T>[] {
  const out: Match<T>[] = [];
  for (const record of records) {
    if (!isLive(record, opts.today) || opts.hidden?.has(record.id)) continue;
    const { score, reasons } = scoreRecord(profile, record, opts.weights);
    if (score <= 0 || score < opts.minScore) continue;
    out.push({ record, score, reasons });
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.record.deadline ?? "9999-12-31").localeCompare(b.record.deadline ?? "9999-12-31") ||
      (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0),
  );
}

/** Today's date (YYYY-MM-DD, UTC) for deadline checks. */
export const todayIso = (now = new Date()): string => now.toISOString().slice(0, 10);

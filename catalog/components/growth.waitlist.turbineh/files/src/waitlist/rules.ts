/**
 * Waitlist positions as a pure rule (component growth.waitlist.turbineh), unit-tested in tests/unit/waitlist.test.ts.
 * Confirmed people queue by confirmation time; every confirmed referral moves the referrer up by `boost` positions
 * (never above the first place). Ties keep the earlier confirmation first.
 */
export interface Queued {
  id: string;
  confirmedAt: Date;
  /** Confirmed people this person referred. */
  referrals: number;
}

/** Position (1-based) of every confirmed person. */
export function positions(entries: Queued[], boost: number): Map<string, number> {
  const base = [...entries].sort(
    (a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime() || a.id.localeCompare(b.id),
  );
  const ranked = base
    // Moving up N places means passing the N people ahead: land just before the one N places up.
    .map((e, i) => {
      const up = boost * e.referrals;
      return { id: e.id, key: up > 0 ? i - up - 0.5 : i, tie: i };
    })
    .sort((a, b) => a.key - b.key || a.tie - b.tie);
  return new Map(ranked.map((r, i) => [r.id, i + 1]));
}

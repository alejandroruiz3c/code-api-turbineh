import { describe, expect, it } from "vitest";
import { MatchingParams, matchingConfig } from "@/matching/config";
import { parseFilters, profileInput, recordInput } from "@/matching/rules";
import {
  containsTerm,
  isLive,
  matchRecords,
  normalize,
  parseTerms,
  reasonText,
  scoreRecord,
  type MatchCandidate,
} from "@/matching/score";

const W = { sectors: 3, activities: 2, regions: 2, keywords: 1 };
const profile = {
  sectors: ["Renewable energy"],
  activities: ["Installation"],
  regions: ["Andalucía", "Portugal"],
  keywords: ["solar", "battery storage"],
};
const rec = (over: Partial<MatchCandidate> & { id: string }): MatchCandidate => ({
  title: "",
  description: "",
  sector: null,
  activity: null,
  region: null,
  deadline: null,
  status: "open",
  ...over,
});
const TODAY = "2026-10-20";

describe("matching (domain.matching.turbineh)", () => {
  it("matches terms as whole words, ignoring case and accents", () => {
    expect(normalize("  Énergie  RENOUVELABLE—Sud ")).toBe("energie renouvelable sud");
    expect(containsTerm("Solar farms in Andalucia", "solar")).toBe(true);
    expect(containsTerm("Solarium refurbishment", "solar")).toBe(false);
    expect(containsTerm("Sevilla, ANDALUCIA (Spain)", "Andalucía")).toBe(true);
    expect(containsTerm("anything", "  ")).toBe(false);
  });

  it("matches multi-word keywords only as the whole phrase", () => {
    expect(containsTerm("Grid-scale battery storage pilot", "battery storage")).toBe(true);
    expect(containsTerm("Battery recycling and cold storage", "battery storage")).toBe(false);
  });

  it("scores each dimension with its weight and says why (sector, activity, region, keyword)", () => {
    const r = rec({
      id: "a",
      title: "Solar plant with battery storage",
      description: "EPC tender",
      sector: "Renewable energy",
      activity: "Installation and maintenance",
      region: "Sevilla, Andalucía",
    });
    const { score, reasons } = scoreRecord(profile, r, W);
    expect(score).toBe(3 + 2 + 2 + 1 + 1);
    expect(reasons.map(reasonText)).toEqual([
      "sector: Renewable energy",
      "activity: Installation",
      "region: Andalucía",
      "keyword: solar",
      "keyword: battery storage",
    ]);
  });

  it("a record that matches nothing, or less than the minimum score, is not a match", () => {
    const none = rec({ id: "n", title: "Office cleaning", sector: "Facilities", region: "Madrid" });
    const weak = rec({ id: "w", title: "Solar lamps for a school", region: "Madrid" });
    expect(scoreRecord(profile, none, W).score).toBe(0);
    expect(
      matchRecords(profile, [none, weak], { weights: W, minScore: 1, today: TODAY }).map(
        (m) => m.record.id,
      ),
    ).toEqual(["w"]);
    expect(matchRecords(profile, [none, weak], { weights: W, minScore: 2, today: TODAY })).toEqual(
      [],
    );
    // A zero weight turns a dimension off.
    expect(scoreRecord(profile, weak, { ...W, keywords: 0 }).score).toBe(0);
  });

  it("orders matches by score, then nearest deadline (none last), then id — the same every time", () => {
    const records = [
      rec({ id: "c", sector: "Renewable energy", deadline: null }),
      rec({ id: "b", sector: "Renewable energy", deadline: "2026-12-01" }),
      rec({ id: "a", sector: "Renewable energy", deadline: "2026-12-01" }),
      rec({ id: "d", sector: "Renewable energy", deadline: "2026-11-01" }),
      rec({ id: "top", sector: "Renewable energy", region: "Portugal", deadline: "2027-01-01" }),
    ];
    const ids = (rs: MatchCandidate[]) =>
      matchRecords(profile, rs, { weights: W, minScore: 1, today: TODAY }).map((m) => m.record.id);
    expect(ids(records)).toEqual(["top", "d", "a", "b", "c"]);
    expect(ids([...records].reverse())).toEqual(["top", "d", "a", "b", "c"]);
  });

  it("leaves out closed records, records past their deadline and records marked not relevant", () => {
    const records = [
      rec({ id: "open", sector: "Renewable energy", deadline: TODAY }),
      rec({ id: "expired", sector: "Renewable energy", deadline: "2026-10-19" }),
      rec({ id: "closed", sector: "Renewable energy", status: "closed" }),
      rec({ id: "hidden", sector: "Renewable energy" }),
    ];
    expect(isLive(records[0]!, TODAY)).toBe(true);
    expect(isLive(records[1]!, TODAY)).toBe(false);
    const ids = matchRecords(profile, records, {
      weights: W,
      minScore: 1,
      today: TODAY,
      hidden: new Set(["hidden"]),
    }).map((m) => m.record.id);
    expect(ids).toEqual(["open"]);
  });

  it("reads profile terms one per line or comma-separated, trimmed and without duplicates", () => {
    expect(parseTerms(" Solar, solar ,\nBattery  storage;\n\nSOLAR")).toEqual([
      "Solar",
      "Battery storage",
    ]);
    expect(
      profileInput.parse({
        sectors: "Health",
        activities: "",
        regions: "Lisboa, Porto",
        keywords: "",
      }),
    ).toEqual({
      sectors: ["Health"],
      activities: [],
      regions: ["Lisboa", "Porto"],
      keywords: [],
    });
  });

  it("validates records: http(s) source links only, ISO deadlines, known statuses", () => {
    const base = {
      title: "Wind farm survey",
      description: "Survey",
      sector: "",
      activity: "",
      region: "",
      deadline: "",
      sourceUrl: "",
      status: "open",
    };
    expect(recordInput.parse(base)).toMatchObject({
      sector: null,
      deadline: null,
      sourceUrl: null,
    });
    expect(recordInput.safeParse({ ...base, sourceUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(recordInput.safeParse({ ...base, deadline: "20/10/2026" }).success).toBe(false);
    expect(recordInput.safeParse({ ...base, status: "won" }).success).toBe(false);
    expect(parseFilters({ status: "bogus", before: "2026-13", q: " solar " })).toEqual({
      q: "solar",
      sector: "",
      region: "",
      status: "",
      before: "",
    });
  });

  it("validates the shipped params", () => {
    expect(MatchingParams.parse(matchingConfig)).toEqual(matchingConfig);
    expect(MatchingParams.safeParse({ ...matchingConfig, minScore: -1 }).success).toBe(false);
  });
});

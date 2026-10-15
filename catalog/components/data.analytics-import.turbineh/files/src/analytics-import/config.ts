import { z } from "zod";
import params from "./params.json";

/**
 * Analytics import (component data.analytics-import.turbineh), written by TurbineH from the request ("managers upload
 * daily sales as CSV (date, shop, product, quantity, revenue) … revenue and units by day, week and month … filters by
 * date range and shop"): the CSV columns and what each one is, the periods, comparisons and exports. Validated at
 * start-up.
 */
export const PERIODS = ["day", "week", "month", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];

export const AnalyticsParams = z.object({
  entity: z.string().max(60).nullable().optional(),
  columns: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/))
    .min(2)
    .max(30),
  dateColumn: z.string().max(40).optional(),
  measures: z.array(z.string().max(40)).optional(),
  scopeColumn: z.string().max(40).nullable().optional(),
  atomic: z.boolean().optional(),
  errorReport: z.boolean().optional(),
  periods: z.array(z.enum(PERIODS)).min(1),
  compareWithPreviousPeriod: z.boolean().optional(),
  filters: z.array(z.string().max(60)).optional(),
  exportCsv: z.boolean().optional(),
});
export type AnalyticsParamsT = z.infer<typeof AnalyticsParams>;

const MEASURE =
  /^(revenue|sales|amount|total|price|cost|quantity|qty|units|count|value|visits|orders|profit|margin|hours|minutes|score)s?$/i;

export interface Dataset {
  entity: string;
  /** Column keys in CSV order (lowercase, spaces → "_"). */
  columns: string[];
  date: string;
  measures: string[];
  dimensions: string[];
  /** Dimension holding per-record access scopes (shop, region), or null. */
  scope: string | null;
  periods: Period[];
  compare: boolean;
  exportCsv: boolean;
}

const keyOf = (c: string) =>
  c
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** What each column is: the date, the measures (numbers) and the dimensions (text), from names or overrides. */
export function toDataset(p: AnalyticsParamsT): Dataset {
  const columns = p.columns.map(keyOf);
  const date =
    (p.dateColumn && keyOf(p.dateColumn)) ||
    columns.find((c) => /^(date|day)$/.test(c)) ||
    columns.find((c) => /date|day/.test(c)) ||
    columns[0]!;
  const measures = (p.measures?.map(keyOf) ?? columns.filter((c) => MEASURE.test(c))).filter(
    (c) => c !== date && columns.includes(c),
  );
  if (measures.length === 0)
    throw new Error("analytics import: no numeric column (set `measures`)");
  const dimensions = columns.filter((c) => c !== date && !measures.includes(c));
  const filterWords = (p.filters ?? []).map(keyOf);
  const scope =
    p.scopeColumn === null
      ? null
      : ((p.scopeColumn && keyOf(p.scopeColumn)) ??
        dimensions.find((d) => filterWords.includes(d)) ??
        null);
  return {
    entity: p.entity ?? "Row",
    columns,
    date,
    measures,
    dimensions,
    scope: scope && dimensions.includes(scope) ? scope : null,
    periods: p.periods,
    compare: p.compareWithPreviousPeriod ?? true,
    exportCsv: p.exportCsv ?? true,
  };
}

export const analyticsParams = AnalyticsParams.parse(params);
export const dataset: Dataset = toDataset(analyticsParams);

export const label = (key: string) => {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

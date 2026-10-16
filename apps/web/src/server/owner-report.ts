import {
  DEFAULT_OWNER_REPORT_EMAIL,
  type OwnerReport,
  ownerUsageReport,
  type ReportWindow,
} from "@turbineh/db";
import { db } from "./db";
import { gatewayEnvConfig } from "./ai-gateway-deps";
import { env } from "./env";

/** Production host: only it emails the weekly report from the cron (staging runs it dry unless told otherwise). */
export const PRODUCTION_HOST = "software.turbineh.com";

/** The owner usage report (ADR-0061) with the gateway's trial cap and exempt owners. */
export function buildOwnerReport(window: Partial<ReportWindow> = {}): Promise<OwnerReport> {
  const cfg = gatewayEnvConfig();
  return ownerUsageReport(db, window, {
    trialCapUsd: cfg.AI_TRIAL_CAP_USD,
    exemptOwners: cfg.AI_TRIAL_EXEMPT_OWNERS.split(","),
  });
}

/** OWNER_REPORT_EMAIL, else ORCHESTRATION_REPORT_EMAIL, else alex.ruiz@turbineh.com. */
export const ownerReportRecipient = () =>
  (env.OWNER_REPORT_EMAIL || env.ORCHESTRATION_REPORT_EMAIL || DEFAULT_OWNER_REPORT_EMAIL).trim();

/** Whether this deployment is production (by its public URL). */
export const isProductionHost = () => {
  try {
    return new URL(env.BETTER_AUTH_URL).host === PRODUCTION_HOST;
  } catch {
    return false;
  }
};

/**
 * `since`/`until` (ISO dates) or `days` from a query string. Invalid values are ignored (since the beginning / now).
 */
export function reportWindow(params: URLSearchParams, now = new Date()): Partial<ReportWindow> {
  const date = (v: string | null) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const until = date(params.get("until")) ?? now;
  const days = Number(params.get("days"));
  const since =
    date(params.get("since")) ??
    (Number.isFinite(days) && days > 0 ? new Date(until.getTime() - days * 86_400_000) : undefined);
  return { until, ...(since ? { since } : {}) };
}

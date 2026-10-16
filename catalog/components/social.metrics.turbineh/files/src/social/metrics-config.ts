import { z } from "zod";
import params from "./params/metrics.json";

/**
 * Metrics schedule (component social.metrics.turbineh): how often a published post's metrics are fetched again and for
 * how many days after publication. Validated at start-up.
 */
export const MetricsParams = z.object({
  refreshHours: z.number().int().min(1).max(168),
  windowDays: z.number().int().min(1).max(365),
});

export const metricsConfig = MetricsParams.parse(params);

/** Start of the followed period: posts published since then are shown and refreshed. */
export const metricsSince = (now = new Date()) =>
  new Date(now.getTime() - metricsConfig.windowDays * 86_400_000);

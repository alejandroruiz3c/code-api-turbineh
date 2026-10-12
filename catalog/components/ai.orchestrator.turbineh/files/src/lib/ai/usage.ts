import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiUsage } from "@/db/schema";

/** AI usage of one workspace over the last `days` days: totals, by purpose and by day (no prices). */
export async function usageSummary(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const scope = and(eq(aiUsage.organizationId, organizationId), gte(aiUsage.createdAt, since));
  const totals = sql<number>`coalesce(sum(${aiUsage.calls}), 0)::int`;
  const tin = sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`;
  const tout = sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`;
  const [total] = await db
    .select({
      calls: totals,
      inputTokens: tin,
      outputTokens: tout,
      requests: sql<number>`count(*)::int`,
    })
    .from(aiUsage)
    .where(scope);
  const byPurpose = await db
    .select({
      purpose: aiUsage.purpose,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`(${tin} + ${tout})::int`,
    })
    .from(aiUsage)
    .where(scope)
    .groupBy(aiUsage.purpose)
    .orderBy(desc(sql`count(*)`));
  const day = sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt}), 'YYYY-MM-DD')`;
  const byDay = await db
    .select({
      day,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`(${tin} + ${tout})::int`,
    })
    .from(aiUsage)
    .where(scope)
    .groupBy(day)
    .orderBy(desc(day));
  return {
    days,
    requests: total?.requests ?? 0,
    calls: total?.calls ?? 0,
    inputTokens: total?.inputTokens ?? 0,
    outputTokens: total?.outputTokens ?? 0,
    byPurpose,
    byDay,
  };
}

import { index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * AI usage per workspace (component ai.orchestrator.turbineh): one row per orchestrated call — calls, tokens,
 * route, model and latency. Queryable per workspace for usage pages and allowances; prices are not stored here.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    purpose: varchar("purpose", { length: 64 }).notNull(),
    route: varchar("route", { length: 32 }),
    model: varchar("model", { length: 120 }),
    decider: varchar("decider", { length: 16 }).notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_org_idx").on(t.organizationId, t.createdAt)],
);

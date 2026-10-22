import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Recommendation tables (component ai.recommendations.turbineh). One catalogue per app: the records staff manage and
 * verify (only verified, active records are ever recommended), and the preferences each conversation recorded.
 */
export const recommendationItems = pgTable(
  "recommendation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short code staff give the record (R-101); the assistant and the compare page use it. */
    reference: varchar("reference", { length: 24 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    location: varchar("location", { length: 120 }).notNull(),
    /** Values of the configured fields (src/recommendations/params.json), validated on save. */
    attributes: jsonb("attributes").$type<Record<string, string | number | null>>().notNull(),
    /** Set by staff after checking the facts; unverified records are never recommended. */
    verified: boolean("verified").notNull().default(false),
    verifiedBy: varchar("verified_by", { length: 320 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recommendation_items_reference_idx").on(t.reference),
    index("recommendation_items_price_idx").on(t.verified, t.active, t.price),
  ],
);

/** Preferences one conversation stated (budget, location, needs), kept so staff see what people look for. */
export const recommendationProfiles = pgTable(
  "recommendation_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The assistant caller (e.g. visitor:<session id>). */
    conversation: varchar("conversation", { length: 120 }).notNull(),
    budgetMax: numeric("budget_max", { precision: 14, scale: 2 }),
    location: varchar("location", { length: 120 }),
    needs: jsonb("needs").$type<Record<string, string | number>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recommendation_profiles_conversation_idx").on(t.conversation)],
);

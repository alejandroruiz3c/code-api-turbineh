// Schema (src/db/schema.ts) and a typed query with drizzle-orm on node-postgres.
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  budget: integer("budget").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
const rows = await db
  .select({ id: projects.id, name: projects.name })
  .from(projects)
  .where(and(eq(projects.organizationId, "org_1"), eq(projects.name, "Website")))
  .orderBy(desc(projects.createdAt));
console.log(rows);

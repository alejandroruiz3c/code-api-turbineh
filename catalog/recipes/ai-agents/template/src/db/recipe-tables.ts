import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
// turbineh:module knowledge-base
import { integer as kbInteger, vector } from "drizzle-orm/pg-core";
// turbineh:end-module knowledge-base
// turbineh:module batch-processes
import { integer } from "drizzle-orm/pg-core";
// turbineh:end-module batch-processes

/** Assistants of a workspace (recipe ai-agents): instructions and the tools an admin enabled for each. */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    instructions: text("instructions").notNull(),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    useKnowledge: boolean("use_knowledge").notNull().default(true),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_org_idx").on(t.organizationId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    needsHuman: boolean("needs_human").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_agent_idx").on(t.organizationId, t.agentId, t.userId)],
);

/** Chat turns. `sources` lists the knowledge documents used for an answer. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    route: varchar("route", { length: 32 }),
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/** Irreversible tool actions wait here until the user confirms or rejects them (AI Safety Pack). */
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  tool: varchar("tool", { length: 48 }).notNull(),
  payload: text("payload").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdBy: varchar("created_by", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// turbineh:module knowledge-base
/** Knowledge base documents and their chunks with embeddings (pgvector, cosine). */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    chars: kbInteger("chars").notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_org_idx").on(t.organizationId)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: kbInteger("position").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  },
  (t) => [
    index("chunks_org_idx").on(t.organizationId),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// turbineh:end-module knowledge-base

// turbineh:module batch-processes
/** Batch AI processing over records: classify, extract or summarise each item. */
export const processes = pgTable(
  "processes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    instruction: text("instruction").notNull(),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("processes_org_idx").on(t.organizationId)],
);

export const processItems = pgTable(
  "process_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    input: text("input").notNull(),
    output: text("output"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("process_items_queue_idx").on(t.status, t.updatedAt)],
);
// turbineh:end-module batch-processes

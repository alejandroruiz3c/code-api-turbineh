import { and, asc, cosineDistance, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chunks, documents } from "@/db/schema";
import { embed } from "@/lib/ai/orchestrator";
import { UserFacingError } from "@/security/errors";
import { chunkText, KNOWLEDGE_LIMITS } from "./chunking";

type Ctx = { organizationId: string; userId: string };

/** Adds a document to the workspace's knowledge base: chunked, embedded through the orchestrator, stored. */
export async function addDocument(ctx: Ctx, title: string, text: string): Promise<string> {
  const clean = text.trim();
  if (clean.length < 20) throw new UserFacingError("The document is too short.");
  if (clean.length > KNOWLEDGE_LIMITS.maxChars) {
    throw new UserFacingError(`Documents can have up to ${KNOWLEDGE_LIMITS.maxChars} characters.`);
  }
  const parts = chunkText(clean);
  const vectors = await embed(parts, { ...ctx, purpose: "knowledge-index" });
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        organizationId: ctx.organizationId,
        title,
        chars: clean.length,
        createdBy: ctx.userId,
      })
      .returning({ id: documents.id });
    if (!doc) throw new Error("document not created");
    await tx.insert(chunks).values(
      parts.map((content, position) => ({
        organizationId: ctx.organizationId,
        documentId: doc.id,
        position,
        content,
        embedding: vectors[position] ?? [],
      })),
    );
    return doc.id;
  });
}

/** Closest passages of the workspace's knowledge base to a question (cosine distance, pgvector). */
export async function searchKnowledge(ctx: Ctx, question: string, k = 4) {
  const [hasDocs] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.organizationId, ctx.organizationId))
    .limit(1);
  if (!hasDocs) return [];
  const [vector] = await embed([question], { ...ctx, purpose: "knowledge-search" });
  if (!vector) return [];
  const distance = cosineDistance(chunks.embedding, vector);
  return db
    .select({ title: documents.title, content: chunks.content, distance })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.organizationId, ctx.organizationId)))
    .orderBy(asc(distance))
    .limit(k);
}

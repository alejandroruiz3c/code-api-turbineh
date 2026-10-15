import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { uploads } from "@/db/schema";
import { env } from "@/env";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { UserFacingError } from "@/security/errors";
import { can } from "@/server/authz";
import { canSeeScope, visibleScopes, type ScopeContext } from "@/server/record-access";
import { sizeLabel, uploadConfig as cfg } from "./config";
import { uploadError } from "./rules";
import { mimeOf, safeFileName, sniffType } from "./sniff";
import { storage } from "./storage";

/**
 * Upload service (component storage.private-uploads.turbineh): the only code that stores, lists, reads or deletes
 * uploaded files. Size, type (by content) and count limits come from src/uploads/params.json; every read is checked
 * against the workspace and the record's scope (src/server/record-access.ts), so a file is downloadable only by the
 * people who may see its record.
 */
export interface Actor extends ScopeContext {
  email: string;
}

export type Upload = typeof uploads.$inferSelect;

export interface UploadTarget {
  /** What the file belongs to: "workspace" (loose files), "workflow:request", "task"… */
  subjectType: string;
  subjectId?: string | null;
  /** Scope of the record (company, project…); null = the whole workspace. */
  scopeId?: string | null;
}

async function visible(ctx: Actor): Promise<SQL | undefined> {
  const scopes = await visibleScopes(ctx);
  if (scopes === "all") return eq(uploads.organizationId, ctx.organizationId);
  return and(
    eq(uploads.organizationId, ctx.organizationId),
    scopes.length ? inArray(uploads.scopeId, scopes) : isNull(uploads.id),
  );
}

export async function saveUpload(ctx: Actor, file: File, target: UploadTarget): Promise<string> {
  if (!can(ctx.role, "create")) throw new UserFacingError("Your role cannot upload files.");
  const scopeId = target.scopeId ?? null;
  if (!(await canSeeScope(ctx, scopeId))) throw new UserFacingError("Choose one of your scopes.");
  const subjectType = target.subjectType.slice(0, 60);
  const subjectId = target.subjectId ?? null;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(uploads)
    .where(
      and(
        eq(uploads.organizationId, ctx.organizationId),
        eq(uploads.subjectType, subjectType),
        subjectId ? eq(uploads.subjectId, subjectId) : isNull(uploads.subjectId),
      ),
    );
  const early = uploadError(file, null, n);
  if (early) throw new UserFacingError(early);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes, cfg.types);
  if (!type || bytes.byteLength > cfg.maxBytes)
    throw new UserFacingError(uploadError(file, bytes, n) ?? "File refused.");
  const storageKey = `${ctx.organizationId}/${randomUUID()}`;
  await storage().put(storageKey, bytes, mimeOf(type));
  let id: string;
  try {
    // The file's row and its audit entry are written together or not at all (ADR-0054).
    id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(uploads)
        .values({
          organizationId: ctx.organizationId,
          scopeId,
          subjectType,
          subjectId,
          fileName: safeFileName(file.name),
          fileType: type,
          mime: mimeOf(type),
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          storageKey,
          uploadedBy: ctx.userId,
          uploadedByEmail: ctx.email.toLowerCase(),
        })
        .returning({ id: uploads.id });
      if (!row) throw new Error("upload not recorded");
      await audit(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "file.uploaded",
          subjectType: "File",
          subjectId: row.id,
          summary: `Uploaded "${safeFileName(file.name)}" (${sizeLabel(bytes.byteLength)})`,
        },
        tx,
      );
      return row.id;
    });
  } catch (err) {
    await storage().delete(storageKey);
    throw err;
  }
  if (cfg.notifyOnUpload) await notifyStaff(ctx, safeFileName(file.name), target);
  return id;
}

/**
 * Tells the people who see every scope (staff) that someone restricted to a scope (a client) uploaded a file; logged
 * when no email provider is configured. Uploads by staff notify nobody.
 */
async function notifyStaff(ctx: Actor, fileName: string, target: UploadTarget): Promise<void> {
  if (can(ctx.role, "see_all_scopes")) return;
  const r = await db.execute<{ email: string; role: string }>(
    sql`select u.email, m.role from member m join "user" u on u.id = m."userId"
         where m."organizationId" = ${ctx.organizationId} and m."userId" <> ${ctx.userId}`,
  );
  const link = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/dashboard/files`;
  for (const m of r.rows.filter((x) => can(x.role, "see_all_scopes"))) {
    await sendEmail({
      to: m.email,
      subject: `New file from ${ctx.email}: ${fileName}`,
      text: `${ctx.email} uploaded "${fileName}"${target.subjectType !== "workspace" ? ` (${target.subjectType})` : ""}.\nOpen it: ${link}`,
    }).catch(() => undefined);
  }
}

/** Files this person may see, newest first (optionally of one record). */
export async function listUploads(
  ctx: Actor,
  target: { subjectType?: string; subjectId?: string | null } = {},
  limit = 200,
): Promise<Upload[]> {
  return db
    .select()
    .from(uploads)
    .where(
      and(
        await visible(ctx),
        target.subjectType ? eq(uploads.subjectType, target.subjectType) : undefined,
        target.subjectId ? eq(uploads.subjectId, target.subjectId) : undefined,
      ),
    )
    .orderBy(desc(uploads.createdAt))
    .limit(limit);
}

/** A file this person may see (workspace + record scope), or a UserFacingError("Not found."). */
export async function getUpload(ctx: Actor, id: string): Promise<Upload> {
  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !(await canSeeScope(ctx, row.scopeId))) throw new UserFacingError("Not found.");
  return row;
}

/** The file and its bytes for an authorised download. */
export async function readUpload(ctx: Actor, id: string) {
  const row = await getUpload(ctx, id);
  const bytes = await storage().get(row.storageKey);
  if (!bytes) throw new UserFacingError("Not found.");
  return { row, bytes };
}

/** The uploader, or a role that may delete, removes a file (bytes and row). */
export async function deleteUpload(ctx: Actor, id: string): Promise<void> {
  const row = await getUpload(ctx, id);
  if (row.uploadedBy !== ctx.userId && !can(ctx.role, "delete"))
    throw new UserFacingError("Only the uploader or someone who may delete can remove this file.");
  // The row and its audit entry go together; the stored bytes are removed once both are committed (ADR-0054).
  await db.transaction(async (tx) => {
    await tx.delete(uploads).where(eq(uploads.id, row.id));
    await audit(
      {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: "file.deleted",
        subjectType: "File",
        subjectId: row.id,
        summary: `Deleted "${row.fileName}"`,
      },
      tx,
    );
  });
  await storage().delete(row.storageKey);
}

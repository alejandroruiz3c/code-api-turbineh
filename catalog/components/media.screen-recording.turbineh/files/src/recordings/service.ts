import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { recordings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import { can, type Role } from "@/server/authz";
import { storage } from "@/uploads/storage";
import { recordingConfig as cfg, sizeLabel } from "./config";
import { hashToken, MIME_OF, newShareToken, TOKEN_SHAPE, videoContainer } from "./media";
import { checkMeta, type RecordingMeta } from "./rules";

export type { RecordingMeta };

/**
 * Recording service (component media.screen-recording.turbineh): the only code that stores, lists, reads, renames,
 * shares or deletes recordings. Every call is scoped to the member's workspace; shared links are looked up by the
 * SHA-256 of their token. Bytes go to the private storage of storage.private-uploads.turbineh.
 */
export interface Member {
  userId: string;
  email: string;
  organizationId: string;
  role: Role;
}
export type Recording = typeof recordings.$inferSelect;

export async function saveRecording(
  ctx: Member,
  bytes: Uint8Array,
  meta: RecordingMeta,
): Promise<string> {
  if (!can(ctx.role, "create")) throw new UserFacingError("Your role cannot record videos.");
  const problem = checkMeta(meta);
  if (problem) throw new UserFacingError(problem);
  if (bytes.byteLength > cfg.maxBytes)
    throw new UserFacingError(`Recordings are limited to ${sizeLabel(cfg.maxBytes)}.`);
  const container = videoContainer(bytes);
  if (!container) throw new UserFacingError("Only WebM or MP4 videos are accepted.");
  const storageKey = `${ctx.organizationId}/${randomUUID()}`;
  await storage().put(storageKey, bytes, MIME_OF[container]);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recordings)
        .values({
          organizationId: ctx.organizationId,
          title: meta.title.trim(),
          storageKey,
          container,
          mime: MIME_OF[container],
          size: bytes.byteLength,
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
          requestedWidth: meta.requestedWidth,
          requestedHeight: meta.requestedHeight,
          frameRate: meta.frameRate,
          layout: meta.layout,
          createdBy: ctx.userId,
        })
        .returning({ id: recordings.id });
      if (!row) throw new Error("recording not stored");
      await audit(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "recording.created",
          subjectType: "recording",
          subjectId: row.id,
          summary: `Recorded "${meta.title.trim()}" (${meta.width}×${meta.height})`,
        },
        tx,
      );
      return row.id;
    });
  } catch (err) {
    await storage()
      .delete(storageKey)
      .catch(() => undefined);
    throw err;
  }
}

export async function listRecordings(ctx: Member): Promise<Recording[]> {
  return db
    .select()
    .from(recordings)
    .where(eq(recordings.organizationId, ctx.organizationId))
    .orderBy(desc(recordings.createdAt))
    .limit(200);
}

/** A recording of the member's workspace, or null (never another workspace's, whatever the id). */
export async function getRecording(ctx: Member, id: string): Promise<Recording | null> {
  const [row] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.organizationId, ctx.organizationId)));
  return row ?? null;
}

async function mine(ctx: Member, id: string, action: "update" | "delete"): Promise<Recording> {
  const row = await getRecording(ctx, id);
  if (!row) throw new UserFacingError("Recording not found.");
  // The person who recorded it, or a role that may change any record of the workspace.
  if (row.createdBy !== ctx.userId && !can(ctx.role, action))
    throw new UserFacingError("Your role cannot change this recording.");
  return row;
}

export async function renameRecording(ctx: Member, id: string, title: string): Promise<void> {
  const t = title.trim();
  if (!t || t.length > 160)
    throw new UserFacingError("Give the recording a title (up to 160 characters).");
  await mine(ctx, id, "update");
  await db
    .update(recordings)
    .set({ title: t })
    .where(and(eq(recordings.id, id), eq(recordings.organizationId, ctx.organizationId)));
}

export async function deleteRecording(ctx: Member, id: string): Promise<void> {
  const row = await mine(ctx, id, "delete");
  await db
    .delete(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.organizationId, ctx.organizationId)));
  await storage()
    .delete(row.storageKey)
    .catch(() => undefined);
}

/** A new share link (replaces any previous one, which stops working). Returns the token, shown once. */
export async function shareRecording(ctx: Member, id: string): Promise<string> {
  if (!cfg.shareLinks) throw new UserFacingError("Sharing by link is turned off in this app.");
  await mine(ctx, id, "update");
  const token = newShareToken();
  await db
    .update(recordings)
    .set({ shareTokenHash: hashToken(token), sharedAt: new Date() })
    .where(and(eq(recordings.id, id), eq(recordings.organizationId, ctx.organizationId)));
  return token;
}

export async function revokeShare(ctx: Member, id: string): Promise<void> {
  await mine(ctx, id, "update");
  await db
    .update(recordings)
    .set({ shareTokenHash: null, sharedAt: null })
    .where(and(eq(recordings.id, id), eq(recordings.organizationId, ctx.organizationId)));
}

/** The recording a share token opens, or null (bad shape, revoked, unknown, or sharing turned off). */
export async function recordingByToken(token: string): Promise<Recording | null> {
  if (!cfg.shareLinks || !TOKEN_SHAPE.test(token)) return null;
  const [row] = await db
    .select()
    .from(recordings)
    .where(eq(recordings.shareTokenHash, hashToken(token)));
  return row ?? null;
}

export async function readBytes(row: Recording): Promise<Uint8Array | null> {
  return storage().get(row.storageKey);
}

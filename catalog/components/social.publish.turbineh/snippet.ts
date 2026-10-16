// Server code in the app (e.g. a server action): a draft a person will review and submit; the job at
// /api/social/publish/run publishes scheduled posts.
import type { Ctx } from "@/social/connections";
import { composePosts } from "@/social/posts";

export async function draftLaunchPost(ctx: Ctx, connectionId: string, formKey: string) {
  return composePosts(ctx, {
    connectionIds: [connectionId],
    text: "We are live: book your first session online.",
    versions: { x: "We are live — book online." },
    imageUrl: null,
    scheduledLocal: "2026-10-20T09:00",
    timeZone: "Europe/Madrid",
    idempotencyKey: formKey,
    intent: "draft",
  });
}

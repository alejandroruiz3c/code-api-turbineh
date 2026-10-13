import { eventsSince, getBuild } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /v1/builds/{id}/events — Server-Sent Events with the live trace; ends when the build finishes. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await getBuild(db, id, caller.ownerId))) return problem(404, "Build not found");
  let last = Number(req.headers.get("last-event-id") ?? 0) || 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send("retry: 2000\n\n");
      const started = Date.now();
      try {
        while (!req.signal.aborted && Date.now() - started < 290_000) {
          const events = await eventsSince(db, id, last);
          for (const e of events) {
            last = e.id;
            send(`id: ${e.id}\nevent: ${e.type === "finished" ? "finished" : "phase"}\ndata: ${JSON.stringify(e)}\n\n`);
            if (e.type === "finished") {
              controller.close();
              return;
            }
          }
          if (events.length === 0) send(": keep-alive\n\n");
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        // client went away or DB error: the client reconnects with Last-Event-ID
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

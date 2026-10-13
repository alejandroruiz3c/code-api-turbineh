import { randomBytes } from "node:crypto";
import { createConnectTicket } from "@turbineh/db";
import { z } from "zod";
import { db } from "@/server/db";
import { appUrl } from "@/server/github";
import { CONNECT_PATH, sha256 } from "@/server/github-oauth";
import { requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

const Body = z.object({ private: z.boolean().default(false) }).default({ private: false });
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * POST /v1/github/connect — for `turbineh connect github`: a one-time link (10 minutes) that runs the same OAuth
 * flow in a browser for this workspace, and a short code shown in the terminal and on the page to confirm. Poll
 * GET /v1/github until `connected`.
 */
export async function POST(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const body = Body.parse(await req.json().catch(() => ({})));
  const ticket = randomBytes(32).toString("base64url");
  const bytes = randomBytes(8);
  const code = [...bytes]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("")
    .replace(/^(.{4})/, "$1-");
  await createConnectTicket(db, {
    ticketHash: sha256(ticket),
    ownerId: caller.ownerId,
    code,
    privateRepos: body.private,
  });
  return Response.json(
    {
      url: `${appUrl()}${CONNECT_PATH}?ticket=${ticket}`,
      code,
      expires_in: 600,
      scope: body.private ? "repo" : "public_repo",
      poll: "/v1/github",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

import { connectTicket } from "@turbineh/db";
import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { oauthDeps } from "@/server/github";
import { CALLBACK_PATH, safeReturn, sha256, startOAuth, STATE_COOKIE } from "@/server/github-oauth";
import { htmlPage } from "@/server/html-page";

export const dynamic = "force-dynamic";

const TICKET = /^[A-Za-z0-9_-]{30,60}$/;

async function redirectToGitHub(input: {
  ownerId: string;
  privateRepos: boolean;
  returnTo: string;
  viaTicket: boolean;
}): Promise<Response> {
  const { url, state } = await startOAuth(oauthDeps(), input);
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: CALLBACK_PATH,
    maxAge: 600,
  });
  return new Response(null, {
    status: 303,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/github/connect?private=1&return=/flows/new — "Connect GitHub" from the product area (invitation cookie).
 * GET /api/github/connect?ticket=… — the link `turbineh connect github` opens: shows the code to confirm, then POST.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const t = TICKET.test(ticket) ? await connectTicket(db, sha256(ticket)) : null;
    if (!t)
      return htmlPage(
        "This link is not valid any more",
        [
          "Run `turbineh connect github` again to get a new link (links last 10 minutes and work once).",
        ],
        undefined,
        400,
      );
    return htmlPage(
      "Connect GitHub to your terminal workspace",
      [
        `Your terminal shows the code \`${t.code}\`. Continue only if it matches and you started this with turbineh connect github.`,
        t.privateRepos
          ? "Access requested: public and private repositories (GitHub scope repo), so TurbineH can open pull requests on private repositories you choose."
          : "Access requested: public repositories only (GitHub scope public_repo).",
        "~Nothing is changed in your repositories until you ask for an integration; you can disconnect at any time with turbineh disconnect github.",
      ],
      { action: "/api/github/connect", fields: { ticket }, button: "Continue to GitHub" },
    );
  }
  const caller = await getCaller();
  if (!caller || caller.kind === "api-key")
    return Response.redirect(
      new URL(`/access?next=${encodeURIComponent("/flows/new")}`, req.url),
      303,
    );
  return redirectToGitHub({
    ownerId: caller.ownerId,
    privateRepos: url.searchParams.get("private") === "1",
    returnTo: safeReturn(url.searchParams.get("return")),
    viaTicket: false,
  });
}

/** POST /api/github/connect (form with the ticket) — consumes the CLI ticket and starts the OAuth flow. */
export async function POST(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const ticket = String(form?.get("ticket") ?? "");
  const t = TICKET.test(ticket) ? await connectTicket(db, sha256(ticket), true) : null;
  if (!t)
    return htmlPage(
      "This link is not valid any more",
      ["Run `turbineh connect github` again to get a new link."],
      undefined,
      400,
    );
  return redirectToGitHub({
    ownerId: t.ownerId,
    privateRepos: t.privateRepos,
    returnTo: "/",
    viaTicket: true,
  });
}

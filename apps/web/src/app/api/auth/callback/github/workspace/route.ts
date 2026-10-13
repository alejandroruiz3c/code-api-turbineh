import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { appUrl, oauthDeps } from "@/server/github";
import { CALLBACK_PATH, finishOAuth, STATE_COOKIE } from "@/server/github-oauth";
import { htmlPage } from "@/server/html-page";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/callback/github/workspace — end of "Connect GitHub" (ADR-0032). Under the OAuth app's registered
 * callback path, separate from sign-in. Checks the state cookie and the stored state (one use), the workspace, then
 * exchanges the code with the PKCE verifier and stores the token encrypted. Never echoes GitHub's answer.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: CALLBACK_PATH });
  const caller = await getCaller();
  const r = await finishOAuth(oauthDeps(), {
    state: url.searchParams.get("state"),
    cookieState,
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    callerOwnerId: caller && caller.kind !== "api-key" ? caller.ownerId : null,
  });
  const back = (returnTo: string, status: string) => {
    const to = new URL(returnTo, appUrl());
    to.searchParams.set("github", status);
    return new Response(null, { status: 303, headers: { Location: to.toString() } });
  };
  if (r.ok) {
    if (r.viaTicket)
      return htmlPage("GitHub connected", [
        `Connected as ${r.login}${r.privateRepos ? " (public and private repositories)" : " (public repositories)"}.`,
        "Return to your terminal: turbineh continues on its own.",
      ]);
    return back(r.returnTo, "connected");
  }
  if (r.reason === "invalid_state")
    return htmlPage(
      "This connection link is not valid any more",
      [
        "It was already used, it expired (10 minutes) or it was started in another browser.",
        "Start again from Connect GitHub in the product (or turbineh connect github).",
      ],
      undefined,
      400,
    );
  return back(
    r.returnTo ?? "/flows/new",
    r.reason === "cancelled"
      ? "cancelled"
      : r.reason === "wrong_workspace"
        ? "wrong_workspace"
        : "error",
  );
}

import { toUserMessage } from "@/security/errors";
import { requireMember } from "@/server/authz";
import { startConnect } from "@/social/connections";
import { appOrigin, isProvider } from "@/social/networks";

/**
 * GET /api/social/oauth/<linkedin|meta|x>/start — sends a workspace manager to the provider's consent page
 * (component social.connections.turbineh). A link, not a form: the provider page is another origin.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = new URL("/dashboard/social", appOrigin());
  if (!isProvider(provider)) return Response.redirect(back, 303);
  const ctx = await requireMember();
  try {
    return Response.redirect(await startConnect(ctx, provider), 303);
  } catch (err) {
    back.searchParams.set("error", toUserMessage(err));
    return Response.redirect(back, 303);
  }
}

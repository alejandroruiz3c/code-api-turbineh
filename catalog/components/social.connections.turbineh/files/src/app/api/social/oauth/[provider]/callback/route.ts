import { toUserMessage } from "@/security/errors";
import { requireMember } from "@/server/authz";
import { finishConnect } from "@/social/connections";
import { appOrigin, isProvider } from "@/social/networks";

/**
 * GET /api/social/oauth/<linkedin|meta|x>/callback — the provider's redirect after consent (component
 * social.connections.turbineh): checks the single-use state, exchanges the code and stores the accounts' tokens
 * encrypted. The redirect URI to register with each provider.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = new URL("/dashboard/social", appOrigin());
  if (!isProvider(provider)) return Response.redirect(back, 303);
  const ctx = await requireMember();
  const q = new URL(req.url).searchParams;
  try {
    const { connected } = await finishConnect(ctx, provider, {
      code: q.get("code"),
      state: q.get("state"),
      error: q.get("error"),
    });
    back.searchParams.set("connected", String(connected));
  } catch (err) {
    back.searchParams.set("error", toUserMessage(err));
  }
  return Response.redirect(back, 303);
}

// Server-only code in the app (e.g. src/social/profile.ts): a provider call with a connected account's token.
import { accessTokenFor, type Ctx } from "@/social/connections";

export async function connectedProfile(ctx: Ctx, connectionId: string): Promise<unknown> {
  // Decrypted on the server for this call only; refreshed when it is about to expire.
  const { token, accountId, network } = await accessTokenFor(ctx.organizationId, connectionId);
  if (network !== "x") return null;
  const res = await fetch(`https://api.x.com/2/users/${accountId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

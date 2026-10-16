import { createHmac } from "node:crypto";
import { providerFetch, type ProviderResponse } from "./http";
import { endpoints } from "./networks";

/**
 * Meta Graph API calls (social.* components): the token travels as `access_token` with `appsecret_proof`
 * (HMAC-SHA256 of the token keyed with the app secret), which Meta accepts always and requires when the app enables
 * "Require App Secret". GET/DELETE send parameters in the query, POST as a form body.
 */
type Env = Record<string, string | undefined>;

export function appsecretProof(token: string, env: Env = process.env): string | null {
  return env.META_APP_SECRET
    ? createHmac("sha256", env.META_APP_SECRET).update(token).digest("hex")
    : null;
}

export async function graph<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string>,
  token: string,
  opts: { env?: Env; fetchImpl?: typeof fetch; network?: "facebook" | "instagram" } = {},
): Promise<ProviderResponse<T>> {
  const env = opts.env ?? process.env;
  const proof = appsecretProof(token, env);
  const all = new URLSearchParams({
    ...params,
    access_token: token,
    ...(proof ? { appsecret_proof: proof } : {}),
  });
  const base = `${endpoints(env).meta.api}${path}`;
  return method === "POST"
    ? providerFetch<T>(
        opts.network ?? "facebook",
        base,
        {
          method,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: all.toString(),
        },
        opts.fetchImpl,
      )
    : providerFetch<T>(opts.network ?? "facebook", `${base}?${all}`, { method }, opts.fetchImpl);
}

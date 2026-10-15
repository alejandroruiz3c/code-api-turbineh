import ky, { type KyInstance } from "ky";
import type { z } from "zod";

/**
 * Client for one external HTTPS API (server side): 10 s timeout, 2 retries only for idempotent requests (GET/HEAD),
 * base URL fixed at creation so callers cannot redirect requests to other hosts.
 */
export function createApiClient(baseUrl: string, headers: Record<string, string> = {}): KyInstance {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("External APIs must use HTTPS");
  return ky.create({
    prefix: url.toString(),
    timeout: 10_000,
    retry: { limit: 2, methods: ["get", "head"] },
    headers,
  });
}

/** GET a JSON resource and validate it: external data is never trusted as-is. */
export async function getJson<T>(
  client: KyInstance,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await client.get(path.replace(/^\/+/, "")).json());
}

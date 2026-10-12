import type { ProductError } from "@turbineh/shared";
import { baseUrl, CliError, token, VERSION } from "./context.js";

/** Thin client of the product API (PLAN §16.4). Errors come back as the API's actionable ProductError. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; workspace?: string | undefined; raw?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      redirect: "follow",
      headers: {
        Authorization: `Bearer ${token()}`,
        "User-Agent": `turbineh-cli/${VERSION}`,
        ...(init.workspace ? { "x-turbineh-workspace": init.workspace } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new CliError({
      code: "network",
      message: `Could not reach ${baseUrl()}: ${err instanceof Error ? err.message : String(err)}.`,
      action: "Check your connection (or TURBINEH_URL) and run the same command again.",
    });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: ProductError;
      title?: string;
      detail?: string;
    } | null;
    throw new CliError(
      body?.error ?? {
        code: res.status === 401 ? "unauthorized" : `http_${res.status}`,
        message: body?.detail ?? body?.title ?? `Request failed (${res.status}).`,
        action:
          res.status === 401
            ? "Run `turbineh login <token>` with the token from your invitation."
            : "Run the same command again; if it keeps failing, check `turbineh status`.",
      },
    );
  }
  if (init.raw) return Buffer.from(await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

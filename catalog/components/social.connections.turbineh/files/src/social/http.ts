import type { Network } from "./networks";

/**
 * Calls to the social networks' APIs (social.* components): one place that sets a timeout, reads the provider's error
 * shape and decides whether a failure may be retried. Errors never carry tokens: the message kept is the provider's
 * short reason with anything token-shaped removed.
 */
export class ProviderError extends Error {
  constructor(
    readonly network: Network | "oauth",
    /** HTTP status, or 0 when the request never got an answer (network error, timeout). */
    readonly status: number,
    /** Provider error code when it gives one (Meta `code`, X `title`/`type`, LinkedIn `serviceErrorCode`). */
    readonly code: string | null,
    message: string,
    /** Milliseconds the provider asked us to wait (Retry-After, x-rate-limit-reset), when it said. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(redact(message).slice(0, 300));
    this.name = "ProviderError";
  }

  /** 429 and 5xx answers and lost requests may succeed later; other 4xx answers will not. */
  get retryable(): boolean {
    if (this.status === 0 || this.status === 429 || this.status >= 500) return true;
    // Meta reports throttling with HTTP 400/403 and codes 4, 17, 32, 613 (application, user, page, custom limits).
    return this.network === "facebook" || this.network === "instagram"
      ? ["4", "17", "32", "613", "80001", "80002"].includes(this.code ?? "")
      : false;
  }

  /** The token was refused (expired or revoked): the connection needs to be connected again. */
  get unauthorized(): boolean {
    return this.status === 401 || this.code === "190";
  }

  /** Short line for logs and screens: status, code and reason. Never a token. */
  get summary(): string {
    return `${this.status || "network"}${this.code ? ` ${this.code}` : ""}: ${this.message}`;
  }
}

/** Removes anything that looks like a token or a secret from a provider message before it is stored or shown. */
export function redact(text: string): string {
  return text
    .replace(
      /(access_token|refresh_token|client_secret|code_verifier|token)=([^&\s]+)/gi,
      "$1=[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [redacted]")
    .replace(/[A-Za-z0-9._~+/=-]{32,}/g, "[redacted]");
}

const TIMEOUT_MS = 20_000;

function retryAfter(res: Response): number | null {
  const after = res.headers.get("retry-after");
  if (after && /^\d+$/.test(after)) return Number(after) * 1000;
  if (after) {
    const at = Date.parse(after);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  // X: epoch seconds when the window resets.
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - Date.now());
  return null;
}

/** The provider's error code and reason from its JSON error body (Meta, X, LinkedIn and OAuth shapes). */
export function providerReason(body: unknown): { code: string | null; message: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const meta = b.error as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object")
    return {
      code: meta.code != null ? String(meta.code) : null,
      message: String(meta.message ?? "error"),
    };
  if (typeof b.error === "string")
    return { code: b.error, message: String(b.error_description ?? b.error) };
  const errors = Array.isArray(b.errors) ? (b.errors as Record<string, unknown>[]) : [];
  if (b.title || b.detail || errors.length)
    return {
      code:
        b.title != null ? String(b.title) : errors[0]?.code != null ? String(errors[0].code) : null,
      message: String(b.detail ?? errors[0]?.message ?? b.title ?? "error"),
    };
  if (b.serviceErrorCode != null || b.message)
    return {
      code:
        b.serviceErrorCode != null
          ? String(b.serviceErrorCode)
          : b.code != null
            ? String(b.code)
            : null,
      message: String(b.message ?? "error"),
    };
  return { code: null, message: "error" };
}

export interface ProviderResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

/** fetch with a timeout; non-2xx answers and lost requests become a ProviderError. */
export async function providerFetch<T = unknown>(
  network: Network | "oauth",
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderResponse<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(network, 0, null, err instanceof Error ? err.name : "request failed");
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const { code, message } = providerReason(body);
    throw new ProviderError(network, res.status, code, message, retryAfter(res));
  }
  return { status: res.status, headers: res.headers, body: body as T };
}

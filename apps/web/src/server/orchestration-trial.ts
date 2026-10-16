import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { TrialSignupInput, TrialSignupResult } from "@turbineh/db";
import { z } from "zod";
import { TRIAL_CONTACT } from "./ai-gateway";

/**
 * POST /v1/ai/trial-signups (ADR-0059): server-to-server provisioning of an Intelligence Orchestration trial. The
 * landing page's server calls it after the "try it free" form, with `Authorization: Bearer
 * <ORCHESTRATION_SIGNUP_SECRET>`, and emails the person the connection data it gets back. The endpoint does not exist
 * (404) when the secret is not configured.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    trimmed(max).optional(),
  );

export const TrialSignupBody = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((e) => e.toLowerCase()),
  name: trimmed(120),
  company: optionalText(160),
  useCase: optionalText(2000),
  /** The person's IP as seen by the landing server (per-IP rate limit); never stored, only an HMAC of it. */
  clientIp: z
    .string()
    .trim()
    .max(64)
    .refine((ip) => isIP(ip) !== 0, "invalid IP")
    .optional(),
});
export type TrialSignup = z.infer<typeof TrialSignupBody>;

/** Signups allowed per 24 hours: per email, per client IP and in total (bounds the trial spend exposure). */
export interface SignupLimits {
  perEmail: number;
  perIp: number;
  total: number;
}

export interface TrialSignupDeps {
  /** ORCHESTRATION_SIGNUP_SECRET (undefined or empty = endpoint disabled). */
  secret: string | undefined;
  /** Public base URL of the product (BETTER_AUTH_URL). */
  baseUrl: string;
  /** AI_TRIAL_CAP_USD. */
  trialUsd: number;
  limits: SignupLimits;
  /** HMAC of an IP with a server secret. */
  ipHash: (ip: string) => string;
  ownerIdOf: (email: string) => string;
  recent: (input: {
    ownerId: string;
    ipHash: string | null;
  }) => Promise<{ byOwner: number; byIp: number; total: number }>;
  provision: (input: TrialSignupInput) => Promise<TrialSignupResult>;
  /** Trial spend of an account so far (a repeat signup keeps its balance). */
  spent: (ownerId: string) => Promise<number>;
  tokenDefaults: { dailyTokenQuota: number; requestsPerMinute: number };
}

const json = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(status >= 400 ? { "Content-Type": "application/problem+json" } : {}),
      ...headers,
    },
  });
const problem = (status: number, title: string, extra: Record<string, unknown> = {}) =>
  json(status, { type: "about:blank", title, status, ...extra });

/** Constant-time comparison of a presented bearer secret with the configured one (hashes: no length leak). */
export function secretMatches(presented: string, secret: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) && presented.length > 0;
}

/** HMAC of a client IP for the signup rate limit (a distinct purpose from the build quota's hash). */
export const signupIpHash = (key: string) => (ip: string) =>
  createHmac("sha256", key).update(`trial-signup:${ip}`).digest("base64url");

/** Connection data of the product for a base URL. */
export function connection(baseUrl: string): { apiBase: string; mcpUrl: string } {
  const base = baseUrl.replace(/\/+$/, "");
  return { apiBase: `${base}/v1/ai/v1`, mcpUrl: `${base}/v1/ai/mcp` };
}

export async function handleTrialSignup(req: Request, deps: TrialSignupDeps): Promise<Response> {
  const secret = deps.secret?.trim();
  if (!secret) return problem(404, "Not found");
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secretMatches(presented, secret)) return problem(401, "Unauthorized");

  const raw = await req.text();
  if (raw.length > 16_000) return problem(413, "Request too large");
  let body: TrialSignup;
  try {
    const parsed = TrialSignupBody.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success)
      return problem(400, "Invalid request", {
        code: "invalid_request",
        fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))].filter(
          Boolean,
        ),
      });
    body = parsed.data;
  } catch {
    return problem(400, "Invalid request", { code: "invalid_request" });
  }

  const ownerId = deps.ownerIdOf(body.email);
  const ipHash = body.clientIp ? deps.ipHash(body.clientIp) : null;
  const recent = await deps.recent({ ownerId, ipHash });
  if (
    recent.byOwner >= deps.limits.perEmail ||
    (ipHash !== null && recent.byIp >= deps.limits.perIp) ||
    recent.total >= deps.limits.total
  )
    return problem(429, "Too many trial signups, try again later", {
      code: "rate_limited",
      contact: TRIAL_CONTACT,
    });

  const created = await deps.provision({
    email: body.email,
    name: body.name,
    company: body.company ?? null,
    useCase: body.useCase ?? null,
    ipHash,
    ...deps.tokenDefaults,
  });
  const spent = created.existing ? await deps.spent(created.ownerId).catch(() => 0) : 0;
  return json(201, {
    token: created.token,
    prefix: created.prefix,
    ...connection(deps.baseUrl),
    trialUsd: deps.trialUsd,
    remainingUsd: deps.trialUsd > 0 ? Math.max(0, deps.trialUsd - spent) : null,
    existing: created.existing,
    contact: TRIAL_CONTACT,
  });
}

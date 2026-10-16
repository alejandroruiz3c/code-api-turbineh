/** Stable error codes by status, so every /v1 problem carries code/message/action like the product API (audit I-14). */
const CODES: Record<number, [code: string, action: string]> = {
  400: ["bad_request", "Fix the request and send it again."],
  401: [
    "unauthorized",
    "Send Authorization: Bearer <your invitation token or API key> (TURBINEH_TOKEN), or sign in.",
  ],
  403: ["forbidden", "Use an account or workspace that owns this resource."],
  404: ["not_found", "Check the id (list yours with GET /v1/activity)."],
  409: ["conflict", "Wait until the resource is in the right state and try again."],
  415: ["unsupported_media_type", "Send the body as JSON with Content-Type: application/json."],
  422: ["invalid_request", "Fix the field named in the message and send the request again."],
  429: ["quota_exceeded", "Try again tomorrow, or ask for a higher quota."],
  503: ["unavailable", "Try again later."],
};

/** RFC 9457 problem details, with the same top-level code/message/action as productProblem. */
export function problem(
  status: number,
  title: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): Response {
  const [code, action] = CODES[status] ?? [`http_${status}`, "Try again in a moment."];
  return Response.json(
    {
      type: "about:blank",
      title,
      status,
      ...(detail ? { detail } : {}),
      code,
      message: detail ? `${title}: ${detail}` : title,
      action,
      ...extra,
    },
    {
      status,
      headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
    },
  );
}

/** The JSON body, or the marker for a body that is not valid JSON (so callers say so instead of "received null"). */
export const NOT_JSON = Symbol("not-json");
export const readJson = (req: Request): Promise<unknown> => req.json().catch(() => NOT_JSON);

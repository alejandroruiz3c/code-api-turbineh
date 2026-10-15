/** RFC 9457 problem details. */
export function problem(
  status: number,
  title: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { type: "about:blank", title, status, ...(detail ? { detail } : {}), ...extra },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/** Security Pack · errors shown to users never leak internals; details go to server logs only. */
export class UserFacingError extends Error {}

export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  console.error("[server-error]", err instanceof Error ? err.name : "unknown");
  return "Something went wrong. Please try again.";
}

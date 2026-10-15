/**
 * Where to go after signing in or up: only a path of this site ("/invite/abc", "/dashboard/x"), never another origin
 * ("//evil.example", "https://…", "/\\evil"). Anything else gives null (the caller uses its default).
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if ([...value].some((c) => c.charCodeAt(0) < 32)) return null;
  return value;
}

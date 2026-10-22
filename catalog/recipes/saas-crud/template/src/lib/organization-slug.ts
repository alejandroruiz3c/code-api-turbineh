/** A URL-safe, unique slug for a new organization (better-auth requires one). */
export function organizationSlug(name: string, now = Date.now()): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "organization"}-${now.toString(36)}`;
}

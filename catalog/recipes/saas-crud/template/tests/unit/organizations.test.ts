import { describe, expect, it } from "vitest";
import { organizationSlug } from "@/lib/organization-slug";

describe("organizations", () => {
  it("builds a URL-safe, unique slug for a new organization", () => {
    expect(organizationSlug("Énergie Solaire & Co.", 0)).toBe("energie-solaire-co-0");
    expect(organizationSlug("  ", 35)).toBe("organization-z");
    expect(organizationSlug("A".repeat(80), 1)).toMatch(/^a{40}-1$/);
    expect(organizationSlug("Acme", 1)).not.toBe(organizationSlug("Acme", 2));
  });
});

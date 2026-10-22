import { CATALOG_TOTALS, USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/caller", () => ({ getCaller: async () => null }));
vi.mock("@/server/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/activity")>()),
  workspaceActivity: async () => [],
}));

const { default: Home } = await import("./page");
const html = renderToStaticMarkup(await Home());
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x27;/g, "'");
const areas = html.slice(html.indexOf('data-testid="areas"'));

describe("home: what you can build (ADR-0076)", () => {
  it("shows every area from the catalogue with its tagline and verified functions", () => {
    expect(USE_CASES).toHaveLength(11);
    expect(text).toContain("What you can build");
    for (const u of USE_CASES) {
      expect(text).toContain(u.name);
      expect(text).toContain(u.tagline);
      // The first functions as chips; the rest one click away on the catalogue.
      for (const f of u.functions.slice(0, 8)) expect(text, `${u.id}: ${f}`).toContain(f);
      if (u.functions.length > 8) {
        expect(text).toContain(`+${u.functions.length - 8} more`);
        expect(areas).toContain(`href="/catalog#${u.id}"`);
      }
    }
  });

  it("links each add-on to its search in Discover under 'Extend with'", () => {
    const bookings = USE_CASES.find((u) => u.id === "bookings")!;
    expect(bookings.addOns.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Appointment reminders", "SMS", "WhatsApp", "Pay to book"]),
    );
    for (const u of USE_CASES)
      for (const a of u.addOns) {
        expect(areas).toContain(`href="/discover?q=${encodeURIComponent(a.id)}"`);
        expect(text).toContain(a.name);
      }
    expect(text).toContain("Extend with:");
  });

  it("states the totals computed from the catalogue, never a hand-written figure", () => {
    expect(text.replace(/\s+/g, " ")).toContain(
      `${CATALOG_TOTALS.components} verified components · ${CATALOG_TOTALS.useCases} complete use cases · ${CATALOG_TOTALS.functions} functions proved by tests`,
    );
    expect(CATALOG_TOTALS.useCases).toBe(USE_CASES.length);
  });

  it("its examples open a new flow with the request (each is guarded by the scope gate in CI)", () => {
    expect(html).toContain(
      `href="/flows/new?need=${encodeURIComponent("A booking site for a hair salon with SMS reminders the day before")}"`,
    );
  });

  it("no prices and no vendor names of the decision engine", () => {
    expect(text).not.toMatch(/[$€£]\s?\d|\bper month\b|\/mo\b/i);
    expect(text).not.toMatch(/\b(JEV|TypeSafe|quyet)\b/i);
  });
});

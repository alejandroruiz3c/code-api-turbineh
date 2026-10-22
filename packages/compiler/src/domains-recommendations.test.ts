import { describe, expect, it } from "vitest";
import { detectDomains } from "./domains.js";
import { extractRecommendationParams } from "./domains-recommendations.js";

// Synthetic requests (ADR-0072): same kind of need as real ones, other words and names.
const FLATS =
  "Create a chat assistant for Marea Homes, a builder of new apartments in Alicante: it learns each buyer's maximum " +
  "budget, preferred district and how many bedrooms they want, suggests matching apartments from our checked " +
  "inventory, answers questions about any of them, lets buyers compare a few side by side and books a visit to the " +
  "show flat.";

describe("recommendations domain (ai.recommendations.turbineh)", () => {
  it("detects a catalogue recommender for the ai-agents recipe, with the request's words and documented defaults", () => {
    const d = extractRecommendationParams(FLATS);
    expect(d?.component).toBe("ai.recommendations.turbineh");
    expect(d?.params).toMatchObject({
      item: { singular: "property", plural: "properties" },
      customer: { singular: "buyer", plural: "buyers" },
      currency: "EUR",
    });
    expect((d?.params.fields as { key: string }[]).map((f) => f.key)).toEqual([
      "bedrooms",
      "bathrooms",
      "area",
    ]);
    expect(d?.assumptions.join(" ")).toContain("Currency not stated");
    const components = detectDomains(FLATS, "ai-agents").map((x) => x.component);
    expect(components).toEqual(["domain.bookings.turbineh", "ai.recommendations.turbineh"]);
    // The booking domain books the request's word for what is booked.
    const bookings = detectDomains(FLATS, "ai-agents")[0]?.params as {
      services: { name: string }[];
    };
    expect(bookings.services.map((s) => s.name)).toEqual(["Visit"]);
  });

  it("is not a recommender without matching a catalogue to preferences, and only for ai-agents", () => {
    expect(detectDomains(FLATS, "saas-crud")).toEqual([]);
    expect(
      extractRecommendationParams("A support assistant that suggests replies from our help centre"),
    ).toBeNull();
    expect(
      extractRecommendationParams(
        "A CRM that recommends follow-up tasks for each deal and its owner",
      ),
    ).toBeNull();
    expect(
      extractRecommendationParams(
        "An online booking page for a salon: customers pick a service and a free slot",
      ),
    ).toBeNull();
  });

  it("uses the catalogue noun and currency the request states; other catalogues get no invented attributes", () => {
    const d = extractRecommendationParams(
      "An AI advisor for our used-car lot that recommends cars within the customer's budget in dollars and compares them",
    );
    expect(d?.params).toMatchObject({
      item: { singular: "car", plural: "cars" },
      currency: "USD",
      fields: [],
    });
  });
});

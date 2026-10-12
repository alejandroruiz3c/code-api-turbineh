import { describe, expect, it } from "vitest";
import { entityNames, pluralize } from "./naming.js";

describe("pluralize", () => {
  it("handles regular, -y, sibilant and -is endings", () => {
    expect(
      ["task", "category", "box", "status", "class", "analysis", "match"].map(pluralize),
    ).toEqual(["tasks", "categories", "boxes", "statuses", "classes", "analyses", "matches"]);
  });

  it("keeps words that are already plural or uncountable", () => {
    expect(["stats", "settings", "data", "news", "feedback"].map(pluralize)).toEqual([
      "stats",
      "settings",
      "data",
      "news",
      "feedback",
    ]);
  });

  it("pluralizes only the last word of an entity", () => {
    expect(entityNames("StreakStats").labelPlural).toBe("Streak stats");
    expect(entityNames("OrderStatus").table).toBe("order_statuses");
  });
});

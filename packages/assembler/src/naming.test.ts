import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entitiesToGenerate, providedTables } from "./entities.js";
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

describe("entities already provided by the app", () => {
  it("skips a generated entity whose table a native component already defines", () => {
    const app = mkdtempSync(join(tmpdir(), "app-"));
    mkdirSync(join(app, "src/db"), { recursive: true });
    writeFileSync(
      join(app, "src/db/component-subscriptions.ts"),
      'export const subscriptions = pgTable("subscriptions", {});\n',
    );
    writeFileSync(join(app, "src/db/schema.ts"), 'export const x = pgTable("ignored", {});\n');
    expect(providedTables(app)).toEqual(["subscriptions"]);
    const spec = {
      entities: [
        { name: "Subscription", fields: [{ name: "plan", type: "string", required: true }] },
        { name: "Gallery", fields: [{ name: "title", type: "string", required: true }] },
      ],
    } as unknown as Parameters<typeof entitiesToGenerate>[0];
    expect(entitiesToGenerate(spec, providedTables(app)).map((e) => e.name)).toEqual(["Gallery"]);
  });
});

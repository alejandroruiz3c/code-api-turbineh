import { describe, expect, it } from "vitest";
import { agentToolFiles, lookupEntities } from "./agent-tools.js";

const order = {
  name: "Order",
  fields: [
    { name: "orderNumber", type: "string" },
    { name: "status", type: "string" },
  ],
} as never;
const product = { name: "Product", fields: [{ name: "name", type: "string" }] } as never;
const spec = (c: string) => ({ summary: "Shop support", acceptance_criteria: [c] });

describe("agent lookup tools (I-1)", () => {
  it("generates a tenant-scoped lookup tool when the assistant looks an entity up", () => {
    const s = spec("The assistant looks up order status by order number");
    expect(lookupEntities(s, [order, product]).map((e: { name: string }) => e.name)).toEqual([
      "Order",
    ]);
    const files = agentToolFiles(s, [order, product]);
    expect(files.map((f) => f.path)).toEqual([
      "src/server/agent-tools.ts",
      "tests/unit/agent-tools.test.ts",
    ]);
    expect(files[0]!.content).toContain('name: "lookup_order"');
    expect(files[0]!.content).toContain("eq(orders.organizationId, ctx.organizationId)");
    expect(files[0]!.content).toContain("No order found");
  });

  it("weak verbs need the entity plus an identifier", () => {
    expect(lookupEntities(spec("Staff can find orders in the list"), [order])).toEqual([]);
    expect(lookupEntities(spec("Staff check products before shipping orders"), [order])).toEqual(
      [],
    );
    expect(
      lookupEntities(spec("The assistant checks the order number the customer gives"), [order]),
    ).toHaveLength(1);
    expect(agentToolFiles(spec("Customers create orders"), [order])).toEqual([]);
  });
});

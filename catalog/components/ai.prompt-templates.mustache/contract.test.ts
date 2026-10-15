import { describe, expect, it } from "vitest";
import Mustache from "mustache";
describe("mustache contract", () => {
  it("renders logic-less templates; values are inserted, never executed", () => {
    const tpl = "Classify the ticket from {{customer.name}}:\n{{#lines}}- {{.}}\n{{/lines}}";
    const out = Mustache.render(
      tpl,
      { customer: { name: "Ana" }, lines: ["late {{delivery}}", "<b>broken</b>"] },
      {},
      {
        escape: (s: string) => s,
      },
    );
    expect(out).toBe("Classify the ticket from Ana:\n- late {{delivery}}\n- <b>broken</b>\n");
  });
});

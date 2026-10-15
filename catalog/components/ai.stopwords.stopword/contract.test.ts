import { describe, expect, it } from "vitest";
import { eng, removeStopwords, spa } from "stopword";
describe("stopword contract", () => {
  it("removes stopwords in several languages", () => {
    expect(removeStopwords("the invoice for the customer is late".split(" "), eng)).toEqual([
      "invoice",
      "customer",
      "late",
    ]);
    expect(removeStopwords("la factura del cliente llega tarde".split(" "), spa)).toEqual([
      "factura",
      "cliente",
      "llega",
      "tarde",
    ]);
  });
});

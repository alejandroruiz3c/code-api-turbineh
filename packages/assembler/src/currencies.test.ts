import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRequestedCurrencies, requestedCurrencies } from "./currencies.js";

describe("requested currencies", () => {
  it("keeps the order of mention and ignores ambiguous or other dollars", () => {
    expect(requestedCurrencies("Prices in euros, also sold in USD")).toEqual(["eur", "usd"]);
    expect(requestedCurrencies("Precios en dólares y euros")).toEqual(["usd", "eur"]);
    expect(requestedCurrencies("Ships to Canada, prices in Canadian dollars")).toEqual(["cad"]);
    expect(requestedCurrencies("Costs $10 per month")).toEqual([]);
    expect(requestedCurrencies("Handmade soap shop")).toEqual([]);
  });

  it("writes them into the storefront .env.example only when the request names any", () => {
    const dir = mkdtempSync(join(tmpdir(), "cur-"));
    writeFileSync(join(dir, ".env.example"), "SHOP_CURRENCY=eur\nSHOP_CURRENCIES=\nOTHER=1\n");
    const spec = (summary: string) =>
      ({ summary, acceptance_criteria: [] }) as unknown as Parameters<
        typeof applyRequestedCurrencies
      >[1];
    expect(applyRequestedCurrencies(dir, spec("Sock shop selling in GBP and EUR"))).toEqual([
      "gbp",
      "eur",
    ]);
    expect(readFileSync(join(dir, ".env.example"), "utf8")).toBe(
      "SHOP_CURRENCY=gbp\nSHOP_CURRENCIES=eur\nOTHER=1\n",
    );
    expect(applyRequestedCurrencies(dir, spec("Sock shop"))).toEqual([]);
  });
});

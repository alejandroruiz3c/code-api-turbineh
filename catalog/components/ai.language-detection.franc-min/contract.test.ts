import { describe, expect, it } from "vitest";
import { franc } from "franc-min";
describe("franc-min contract", () => {
  it("detects the language of a paragraph offline", () => {
    expect(
      franc("The customer asked for a refund because the parcel arrived damaged and late."),
    ).toBe("eng");
    expect(
      franc("El cliente pidió un reembolso porque el paquete llegó dañado y con retraso."),
    ).toBe("spa");
    expect(franc("ok")).toBe("und");
  });
});

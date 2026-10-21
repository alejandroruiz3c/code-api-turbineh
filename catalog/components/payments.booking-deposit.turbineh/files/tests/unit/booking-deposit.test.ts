import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  amountDue,
  checkoutForm,
  currencyOf,
  DepositParams,
  verifyStripeSignature,
  type DepositConfig,
} from "@/payments/deposit";

const cfg = (over: Partial<DepositConfig>): DepositConfig => ({
  mode: "deposit",
  percent: null,
  amount: 10,
  currency: "eur",
  holdMinutes: 30,
  ...over,
});
const cut = { name: "Cut", price: 25, currency: "EUR" };
const colour = { name: "Colour", price: 70.5, currency: "€" };
const consult = { name: "Consultation", price: null, currency: null };

describe("amount due when booking (computed on the server)", () => {
  it("charges a fixed deposit per booking, never more than the service price", () => {
    expect(amountDue(cut, cfg({ amount: 10 }))).toEqual({
      cents: 1000,
      currency: "eur",
      kind: "deposit",
    });
    expect(amountDue({ ...cut, price: 8 }, cfg({ amount: 10 }))).toEqual({
      cents: 800,
      currency: "eur",
      kind: "full",
    });
    expect(amountDue(consult, cfg({ amount: 10 }))).toEqual({
      cents: 1000,
      currency: "eur",
      kind: "deposit",
    });
  });

  it("charges a percent of the price rounded half up to the cent, and nothing for unpriced services", () => {
    expect(amountDue(colour, cfg({ amount: null, percent: 20 }))).toEqual({
      cents: 1410,
      currency: "eur",
      kind: "deposit",
    });
    expect(amountDue({ ...cut, price: 0.125 }, cfg({ amount: null, percent: 50 }))?.cents).toBe(7);
    expect(amountDue(consult, cfg({ amount: null, percent: 20 }))).toBeNull();
  });

  it("charges the full price in full mode (the fixed amount only for unpriced services)", () => {
    expect(amountDue(colour, cfg({ mode: "full", amount: null }))).toEqual({
      cents: 7050,
      currency: "eur",
      kind: "full",
    });
    expect(amountDue(consult, cfg({ mode: "full", amount: null }))).toBeNull();
    expect(amountDue(consult, cfg({ mode: "full", amount: 30 }))?.cents).toBe(3000);
  });

  it("reads currencies written as codes or symbols", () => {
    expect(currencyOf({ name: "x", price: 1, currency: "$" }, cfg({}))).toBe("usd");
    expect(currencyOf({ name: "x", price: 1, currency: "GBP" }, cfg({}))).toBe("gbp");
    expect(currencyOf({ name: "x", price: 1, currency: null }, cfg({ currency: "chf" }))).toBe(
      "chf",
    );
  });

  it("refuses params that cannot compute a deposit or hold shorter than Stripe allows", () => {
    expect(DepositParams.safeParse(cfg({ amount: null, percent: null })).success).toBe(false);
    expect(DepositParams.safeParse(cfg({ holdMinutes: 10 })).success).toBe(false);
    expect(DepositParams.safeParse(cfg({ percent: 150 })).success).toBe(false);
  });
});

describe("Stripe Checkout session for a held booking", () => {
  it("asks for one card payment of exactly the server's amount, tied to the booking, expiring with the hold", () => {
    const f = checkoutForm({
      appointmentId: "8d1c1f6e-6b1e-4a43-9a43-5c8f4f1d2a10",
      reference: "AB12CD34",
      business: "Sala Nueve",
      service: "Cut",
      when: "Tue 3 Nov 10:00 (Europe/Madrid)",
      email: "ana@example.com",
      cents: 1000,
      currency: "eur",
      kind: "deposit",
      expiresAt: 1_900_000_000,
      successUrl: "https://salon.example/book/paid?ref=AB12CD34&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://salon.example/book",
    });
    expect(Object.fromEntries(f)).toMatchObject({
      mode: "payment",
      "payment_method_types[0]": "card",
      client_reference_id: "8d1c1f6e-6b1e-4a43-9a43-5c8f4f1d2a10",
      customer_email: "ana@example.com",
      expires_at: "1900000000",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "1000",
      "line_items[0][price_data][product_data][name]": "Deposit: Cut — Sala Nueve",
      "metadata[booking_reference]": "AB12CD34",
    });
  });
});

describe("Stripe webhook signature", () => {
  const secret = `whsec_${randomBytes(16).toString("hex")}`;
  const body = JSON.stringify({ type: "checkout.session.completed" });
  const sign = (t: number, s = secret) =>
    `t=${t},v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`;

  it("accepts Stripe's signature and refuses forged, stale or missing ones", () => {
    const now = Date.now();
    const t = Math.floor(now / 1000);
    expect(verifyStripeSignature(body, sign(t), secret, now)).toBe(true);
    expect(
      verifyStripeSignature(body, sign(t, `whsec_${randomBytes(8).toString("hex")}`), secret, now),
    ).toBe(false);
    expect(verifyStripeSignature(`${body} `, sign(t), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(t - 600), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });
});

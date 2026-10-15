import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasPaidAccess, verifySignature } from "@/lib/billing-rules";

describe("payments.subscriptions.turbineh", () => {
  it("gives Pro access only to active or trialing subscriptions", () => {
    expect(hasPaidAccess("pro", "active")).toBe(true);
    expect(hasPaidAccess("pro", "trialing")).toBe(true);
    expect(hasPaidAccess("pro", "past_due")).toBe(false);
    expect(hasPaidAccess("free", "active")).toBe(false);
  });

  it("verifies Stripe signatures with replay protection", () => {
    const secret = "whsec_unit_test";
    const body = '{"type":"x"}';
    const t = 1_800_000_000;
    const header = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    expect(verifySignature(body, header, secret, t)).toBe(true);
    expect(verifySignature(body, header, secret, t + 301)).toBe(false);
    expect(verifySignature(`${body} `, header, secret, t)).toBe(false);
  });
});

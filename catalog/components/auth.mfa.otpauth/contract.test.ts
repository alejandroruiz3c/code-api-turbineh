import { describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
describe("otpauth contract", () => {
  it("generates and validates a TOTP code", () => {
    const totp = new TOTP({ secret: new Secret({ size: 20 }), digits: 6, period: 30 });
    const token = totp.generate();
    expect(token).toMatch(/^\d{6}$/);
    expect(totp.validate({ token, window: 1 })).toBe(0);
    expect(totp.toString()).toContain("otpauth://totp/");
  });
});

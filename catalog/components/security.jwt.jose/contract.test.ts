import { describe, expect, it } from "vitest";
import { SignJWT, jwtVerify } from "jose";
describe("jose contract", () => {
  it("signs and verifies, rejecting a wrong key", async () => {
    const key = new TextEncoder().encode("k".repeat(32));
    const jwt = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(key);
    expect((await jwtVerify(jwt, key)).payload.sub).toBe("u1");
    await expect(jwtVerify(jwt, new TextEncoder().encode("x".repeat(32)))).rejects.toThrow();
  });
});

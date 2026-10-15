import { describe, expect, it } from "vitest";
import ky from "ky";
describe("ky contract", () => {
  it("creates configured clients", () => {
    const api = ky.create({ prefix: "https://api.example.com", timeout: 5000, retry: 2 });
    expect(typeof api.get).toBe("function");
  });
});

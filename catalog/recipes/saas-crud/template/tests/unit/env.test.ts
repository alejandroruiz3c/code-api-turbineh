import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Variables src/env.ts requires (no .optional() / .default()), read from the schema itself. */
function requiredVars(): string[] {
  const src = readFileSync("src/env.ts", "utf8");
  const keys = [...src.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)];
  return keys
    .filter((k, i) => {
      const chunk = src.slice(k.index, keys[i + 1]?.index ?? src.length);
      return !/\.optional\(\)|\.default\(/.test(chunk) && k[1] !== "NODE_ENV";
    })
    .map((k) => k[1] as string);
}

/** A valid sample value per kind of variable (never a real secret). */
const sample = (name: string) =>
  name === "DATABASE_URL"
    ? "postgres://postgres:postgres@127.0.0.1:54329/postgres"
    : name.endsWith("_URL")
      ? "http://127.0.0.1:3000"
      : "x".repeat(40);

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe("environment", () => {
  it("builds and runs with only the required variables; an empty staff allow-list denies everyone", async () => {
    process.env = {
      ...Object.fromEntries(requiredVars().map((n) => [n, sample(n)])),
      NODE_ENV: "test",
    };
    vi.resetModules();
    const { env } = await import("@/env");
    expect(env.DATABASE_URL).toBeTruthy();
    expect(env.ADMIN_EMAILS).toBe("");
    const { isStaff } = await import("@/lib/staff");
    expect(isStaff({ email: "owner@example.com", emailVerified: true })).toBe(false);
  });

  it("`next build` without settings gets throwaway values generated at runtime, never literals", async () => {
    process.env = { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" };
    vi.resetModules();
    const first = (await import("@/env")).env.BETTER_AUTH_SECRET;
    vi.resetModules();
    const second = (await import("@/env")).env.BETTER_AUTH_SECRET;
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
    // Outside the build the same missing settings stop the app.
    process.env = { NODE_ENV: "production" };
    vi.resetModules();
    await expect(import("@/env")).rejects.toThrow();
  });

  it("src/env.ts holds no secret-shaped literal (the gate's turbineh.hardcoded-secret rule)", () => {
    const src = readFileSync("src/env.ts", "utf8");
    const literal =
      /(?:const\s+\w*(?:secret|password|passwd|api_?key|token|private_?key)\w*\s*=|\w*(?:secret|password|passwd|api_?key|token|private_?key)\w*\s*:)\s*"[A-Za-z0-9_+/=-]{16,}"/i;
    expect(src).not.toMatch(literal);
  });

  it("allow-lists are never required", () => {
    expect(requiredVars().filter((n) => /EMAILS|ALLOW|DOMAINS/.test(n))).toEqual([]);
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * F-12 (ADR-0065): state that must hold across serverless instances lives in the app's PostgreSQL. Every recipe gets
 * the Security Pack's PostgreSQL-backed rate limiter (all extend saas-crud), and no recipe or component ships an
 * in-process limiter that would silently stop limiting on Vercel.
 */
const catalog = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog");
const recipes = join(catalog, "recipes");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const shipped = (p: string) =>
  /\.(ts|tsx|mjs|js)$/.test(p) && !/(^|\/)tests\//.test(p) && !/\.(test|spec)\.[jt]sx?$/.test(p);

describe("shared state is in PostgreSQL in every template (F-12)", () => {
  it("every recipe is saas-crud or extends a chain that reaches it", () => {
    const ids = readdirSync(recipes).filter((r) => existsSync(join(recipes, r, "recipe.yaml")));
    const parent = new Map(
      ids.map((r) => {
        const y = parse(readFileSync(join(recipes, r, "recipe.yaml"), "utf8")) as {
          extends?: string;
        };
        return [r, y.extends ?? null] as const;
      }),
    );
    for (const r of ids) {
      let at: string | null = r;
      const seen = new Set<string>();
      while (at && at !== "saas-crud" && !seen.has(at)) {
        seen.add(at);
        at = parent.get(at) ?? null;
      }
      expect(at, `${r} must extend saas-crud`).toBe("saas-crud");
    }
  });

  it("the Security Pack's limiter uses PostgreSQL outside tests", () => {
    const src = readFileSync(
      join(recipes, "saas-crud/template/src/security/rate-limit.ts"),
      "utf8",
    );
    expect(src).toMatch(/export const postgresStore/);
    expect(src).toMatch(
      /process\.env\.RATE_LIMIT_STORE === "memory" \|\| process\.env\.NODE_ENV === "test"\s*\?\s*memory\s*:\s*postgresStore/,
    );
  });

  it("no recipe or component ships its own in-process rate limiter", () => {
    const offenders = [
      ...files(join(catalog, "recipes")),
      ...readdirSync(join(catalog, "components")).flatMap((c) =>
        files(join(catalog, "components", c, "files")).concat(
          files(join(catalog, "components", c, "files-with")),
        ),
      ),
    ]
      .filter(shipped)
      .filter((p) => !p.endsWith("saas-crud/template/src/security/rate-limit.ts"))
      .filter((p) =>
        /RateLimiterMemory|function rateLimit\b|const rateLimit\s*=|rate-limit\.(ts|js)$/.test(
          `${readFileSync(p, "utf8")}\n${p}`,
        ),
      )
      .map((p) => relative(catalog, p));
    expect(offenders).toEqual([]);
  });
});

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_MAX_ROWS, exportTooLarge } from "@/lib/csv";

/**
 * Fixed invariants of the generated records (ADR-0054), checked on the app's own files: they hold for every request,
 * so no change to the app can make them pass by weakening what they check.
 */
const files = (dir: string, re: RegExp): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => re.test(f))
        .map((f) => join(dir, f))
    : [];

/** Secret-shaped field names: never a column, a form field, a list cell or a CSV column of a generated record. */
const SECRET =
  /^(?:\w*(?:password|passwd|passphrase|secret|credential|apikey|api_key|privatekey|private_key)\w*|\w*(?:access|refresh|auth|bearer|api|session|id)?_?token)$/i;

describe("generated records never hold secrets", () => {
  it("no generated table, form schema or CSV export has a secret-shaped field (token, secret, password, API key…)", () => {
    const generated = [
      ...files("src/db/tables", /\.ts$/),
      ...files("src/entities", /schema\.ts$/),
      ...files("src/app", /export[\\/]route\.ts$/),
    ];
    const leaks = generated.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\b([A-Za-z_][\w]*)\s*:|"([A-Za-z_]\w*)"/g)]
        .map((m) => m[1] ?? m[2] ?? "")
        .filter((name) => SECRET.test(name))
        .map((name) => `${f}: ${name}`),
    );
    expect(leaks).toEqual([]);
  });
});

describe("generated forms never set workflow state or tenant ids", () => {
  it("no create/edit form schema accepts status, stage, approval stamps or a workspace/tenant id", () => {
    const leaks = files("src/entities", /schema\.ts$/).flatMap((f) => {
      const src = readFileSync(f, "utf8");
      const block = /Schema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(src)?.[1] ?? "";
      return [...block.matchAll(/^\s{2}(\w+):/gm)]
        .map((m) => m[1] ?? "")
        .filter((k) =>
          /^(?:\w*Status|status|(?:is)?(?:approved|published|rejected|archived|paid|verified)(?:At|By|On|Date)?|organizationId|workspaceId|tenantId|orgId)$/i.test(
            k,
          ),
        )
        .map((k) => `${f}: ${k}`);
    });
    expect(leaks).toEqual([]);
  });
});

describe("CSV exports are never silently truncated", () => {
  it("an export over the limit is refused with an explicit message", async () => {
    const res = exportTooLarge();
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/more than .* rows\. Narrow the filters/);
    expect(EXPORT_MAX_ROWS).toBeGreaterThanOrEqual(10_000);
  });

  it("every generated export route checks the limit before answering", () => {
    for (const f of files("src/app", /export[\\/]route\.ts$/)) {
      const src = readFileSync(f, "utf8");
      if (!src.startsWith("// turbineh:generated")) continue;
      expect(src, f).toMatch(/limit\(EXPORT_MAX_ROWS \+ 1\)/);
      expect(src, f).toMatch(/exportTooLarge\(\)/);
    }
  });
});

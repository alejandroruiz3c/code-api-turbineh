import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exampleErrors,
  importStatements,
  isJsonExample,
  repairImportSignatures,
  shellReferences,
  snippetFromContract,
  snippetPackages,
} from "./snippets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("snippetFromContract", () => {
  it("keeps the real imports, drops vitest and turns assertions into logged values", () => {
    const s = snippetFromContract(`import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { unused, used } from "pkg/sub";
describe("c", () => {
  const seed = used(1);
  it("writes a workbook", async () => {
    const wb = new ExcelJS.Workbook();
    expect(wb.creator).toBe("me");
    expect(() => JSON.parse("{")).toThrow(/JSON/);
    await expect(Promise.reject(new Error("x"))).rejects.toThrow();
    expect(seed).not.toContain("z");
  });
  it("second test is not part of the snippet", () => {
    expect(1).toBe(1);
  });
});
`);
    expect(s?.title).toBe("writes a workbook");
    expect(s?.code).toBe(`import ExcelJS from "exceljs";
import { used } from "pkg/sub";

const seed = used(1);
const wb = new ExcelJS.Workbook();
console.log(wb.creator); // → "me"
try {
  JSON.parse("{");
} catch (err) {
  console.log(err); // → throws /JSON/
}
await Promise.reject(new Error("x")).catch((err: unknown) => console.log(err)); // → rejects: throws
console.log(seed); // → does not contain "z"
`);
    expect(s?.code).not.toMatch(/expect|vitest|second test/);
  });

  it("rewrites assertions nested in loops", () => {
    const s = snippetFromContract(`import { expect, it } from "vitest";
it("t", () => {
  for (const x of [1, 2]) {
    expect(x).toBeGreaterThan(0);
  }
});
`);
    expect(s?.code).toContain("  console.log(x); // → > 0");
  });
});

describe("import signatures", () => {
  it("are taken from the imports the component really uses", () => {
    const usage = `import ExcelJS from "exceljs";\nimport i18next from "i18next";\nimport { organizationClient } from "better-auth/client/plugins";\nimport * as z from "zod";`;
    expect(importStatements(usage).get("ExcelJS")?.signature).toBe('import ExcelJS from "exceljs"');
    const fixed = repairImportSignatures(
      [
        { name: "ExcelJS", signature: 'import { ExcelJS } from "exceljs"' },
        {
          name: "organizationClient",
          signature: 'import { organizationClient } from "better-auth"',
        },
        { name: "z", signature: 'import { z } from "zod"' },
        { name: "Other", signature: "Other(x) → y" },
      ],
      [usage],
    );
    expect(fixed.map((i) => i.signature)).toEqual([
      'import ExcelJS from "exceljs"',
      'import { organizationClient } from "better-auth/client/plugins"',
      'import * as z from "zod"',
      "Other(x) → y",
    ]);
  });

  it("list the pinned packages a snippet compiles against", () => {
    const code = `import a from "exceljs";\nimport { b } from "@radix-ui/react-tabs";\nimport { c } from "dinero.js/currencies";\nimport { d } from "@/lib/x";\nimport e from "node:fs";`;
    expect(
      snippetPackages(code, {
        exceljs: "4.4.0",
        "@radix-ui/react-tabs": "1.1.0",
        "dinero.js": "2.0.0",
      }),
    ).toEqual(["@radix-ui/react-tabs@1.1.0", "dinero.js@2.0.0", "exceljs@4.4.0"]);
  });
});

describe("non-code examples", () => {
  it("recognise JSON params and shell references", () => {
    expect(isJsonExample('// src/x/params.json\n{ "a": 1 }\n')).toBe(true);
    expect(isJsonExample("import x from 'y'")).toBe(false);
    expect(shellReferences('turbineh plan "x"\ncurl $BASE/v1/plans/$PLAN/pull-request')).toEqual({
      commands: ["plan"],
      routes: ["/v1/plans/$PLAN/pull-request"],
    });
  });
});

describe("catalogue examples (ADR-0066)", () => {
  it("every component's public example is its own compiled usage, with no drift", () => {
    const dir = join(root, "catalog/components");
    const errors = readdirSync(dir).flatMap((id) =>
      exampleErrors(join(dir, id), root).map((e) => `${id}: ${e}`),
    );
    expect(errors).toEqual([]);
  });
});

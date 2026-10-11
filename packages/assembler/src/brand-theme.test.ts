import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrand, contrastText, decodeLogo, parseBrand } from "./brand-theme.js";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString("base64")}`;
const SVG_AS_PNG = `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"/>').toString("base64")}`;

describe("client brand", () => {
  it("keeps only valid values", () => {
    expect(parseBrand({ primaryColor: "#FF0055", font: "serif", logo: PNG })).toEqual({
      primaryColor: "#ff0055",
      font: "serif",
      logo: PNG,
    });
    expect(
      parseBrand({ primaryColor: "red; } body { display:none", font: "comic", logo: SVG_AS_PNG }),
    ).toBeNull();
  });

  it("accepts logos by content, never by declared type", () => {
    expect(decodeLogo(PNG)?.ext).toBe("png");
    expect(decodeLogo(SVG_AS_PNG)).toBeNull();
  });

  it("picks the readable text colour on the brand colour (WCAG)", () => {
    expect(contrastText("#0f172a")).toBe("#ffffff");
    expect(contrastText("#ffe066")).toBe("#000000");
  });

  it("writes theme tokens, the logo and the brand module", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));
    mkdirSync(join(dir, "src/app"), { recursive: true });
    writeFileSync(
      join(dir, "src/app/globals.css"),
      "@theme {\n  --color-brand: #0f172a;\n  --color-brand-contrast: #ffffff;\n  --font-brand: x;\n}\n",
    );
    const applied = applyBrand(dir, { primaryColor: "#ffe066", font: "rounded", logo: PNG });
    const css = readFileSync(join(dir, "src/app/globals.css"), "utf8");
    expect(css).toContain("--color-brand: #ffe066;");
    expect(css).toContain("--color-brand-contrast: #000000;");
    expect(css).toContain("ui-rounded");
    expect(applied.logo).toBe("public/brand/logo.png");
    expect(readFileSync(join(dir, "src/brand.ts"), "utf8")).toContain('"/brand/logo.png"');
  });
});

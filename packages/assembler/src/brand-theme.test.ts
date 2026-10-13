import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBrand,
  applyTheme,
  contrastRatio,
  contrastText,
  decodeLogo,
  DEFAULT_TOKENS,
  parseBrand,
  themeTokens,
} from "./brand-theme.js";

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

describe("theme from the request's palette (S1)", () => {
  const northwind = {
    background: "#001a5a",
    accent: "#34d8c4",
    cta: "#f2b24b",
    font: "system" as const,
  };

  it("derives a complete dark theme with readable text everywhere (WCAG AA)", () => {
    const t = themeTokens(northwind);
    expect(t.surface).toBe("#001a5a");
    expect(t.brand).toBe("#f2b24b");
    expect(t.accent).toBe("#34d8c4");
    expect(t["brand-contrast"]).toBe("#000000");
    for (const bg of [t.surface, t.panel]) {
      expect(contrastRatio(t.ink, bg)).toBeGreaterThanOrEqual(7);
      for (const fg of [t.muted, t.danger, t.success, t.warning, t.info, t.accent]) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio(t.danger, t["danger-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-contrast"], t.brand)).toBeGreaterThanOrEqual(4.5);
    // No light slate surface on a navy page.
    expect(t.panel).not.toBe("#ffffff");
  });

  it("keeps the template defaults without a palette, and the uploaded brand wins", () => {
    expect(themeTokens(null)).toEqual(DEFAULT_TOKENS);
    const t = themeTokens(northwind, { primaryColor: "#ff0055", font: "serif" });
    expect(t.brand).toBe("#ff0055");
    expect(t.font).toContain("ui-serif");
    expect(t.surface).toBe("#001a5a");
  });

  it("darkens an accent that is unreadable on a light page", () => {
    const t = themeTokens({ background: "#ffffff", accent: "#ffe066" });
    expect(contrastRatio(t.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("rewrites the whole @theme block of globals.css", () => {
    const dir = mkdtempSync(join(tmpdir(), "theme-"));
    mkdirSync(join(dir, "src/app"), { recursive: true });
    writeFileSync(
      join(dir, "src/app/globals.css"),
      '@import "tailwindcss";\n@theme {\n  --color-surface: #f8fafc;\n}\nbody { color: red; }\n',
    );
    applyTheme(dir, { palette: northwind });
    const css = readFileSync(join(dir, "src/app/globals.css"), "utf8");
    expect(css).toContain("--color-surface: #001a5a;");
    expect(css).toContain("--color-accent: #34d8c4;");
    expect(css).toContain("--color-brand: #f2b24b;");
    expect(css).toContain("body { color: red; }");
  });

  it("matches the template's default tokens exactly", () => {
    const css = readFileSync(
      join(__dirname, "../../../catalog/recipes/saas-crud/template/src/app/globals.css"),
      "utf8",
    );
    for (const [k, v] of Object.entries(DEFAULT_TOKENS)) {
      if (k !== "font") expect(css).toContain(`--color-${k}: ${v};`);
    }
  });
});

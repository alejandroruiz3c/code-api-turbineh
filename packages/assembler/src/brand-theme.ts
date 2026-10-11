import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Client brand applied as theme tokens (deterministic; no model involved). Fonts are local system stacks only:
 * the app never fetches fonts from a third party.
 */
export const BRAND_FONTS = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  geometric: 'Avenir, Montserrat, Corbel, "URW Gothic", ui-sans-serif, system-ui, sans-serif',
  humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", ui-sans-serif, sans-serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Nunito, ui-sans-serif, sans-serif',
  serif: 'ui-serif, Charter, "Bitstream Charter", Cambria, Georgia, serif',
  mono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
} as const;
export type BrandFont = keyof typeof BRAND_FONTS;

export interface Brand {
  primaryColor?: string;
  font?: BrandFont;
  /** data:image/png|jpeg|webp;base64,… (≤ 256 KB decoded). SVG is not accepted (it can carry scripts). */
  logo?: string;
}

export const LOGO_MAX_BYTES = 256 * 1024;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Logo bytes and extension, only if the content really is PNG, JPEG or WebP (checked by magic bytes). */
export function decodeLogo(dataUrl: string): { bytes: Buffer; ext: "png" | "jpg" | "webp" } | null {
  const m = LOGO.exec(dataUrl);
  if (!m?.[2]) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) return null;
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { bytes, ext: "png" };
  if (starts([0xff, 0xd8, 0xff])) return { bytes, ext: "jpg" };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
    return { bytes, ext: "webp" };
  return null;
}

/** Validated brand or null; anything invalid is dropped, never passed through. */
export function parseBrand(raw: unknown): Brand | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const brand: Brand = {};
  if (typeof r.primaryColor === "string" && HEX.test(r.primaryColor))
    brand.primaryColor = r.primaryColor.toLowerCase();
  if (typeof r.font === "string" && r.font in BRAND_FONTS) brand.font = r.font as BrandFont;
  if (typeof r.logo === "string" && decodeLogo(r.logo)) brand.logo = r.logo;
  return Object.keys(brand).length > 0 ? brand : null;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
export const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** Text colour on the brand colour with the higher WCAG contrast. */
export const contrastText = (hex: string) =>
  contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#000000") ? "#ffffff" : "#000000";

/** Writes the theme tokens, the logo (public/brand/) and src/brand.ts. Returns what was applied. */
export function applyBrand(
  outDir: string,
  brand: Brand,
): { color?: string; font?: BrandFont; logo?: string } {
  const applied: { color?: string; font?: BrandFont; logo?: string } = {};
  const cssPath = join(outDir, "src/app/globals.css");
  let css = readFileSync(cssPath, "utf8");
  if (brand.primaryColor) {
    css = css
      .replace(/--color-brand: #[0-9a-fA-F]{6};/, `--color-brand: ${brand.primaryColor};`)
      .replace(
        /--color-brand-contrast: #[0-9a-fA-F]{6};/,
        `--color-brand-contrast: ${contrastText(brand.primaryColor)};`,
      );
    applied.color = brand.primaryColor;
  }
  if (brand.font) {
    css = css.replace(/--font-brand: [^;]+;/, `--font-brand: ${BRAND_FONTS[brand.font]};`);
    applied.font = brand.font;
  }
  writeFileSync(cssPath, css);
  const logo = brand.logo ? decodeLogo(brand.logo) : null;
  if (logo) {
    const rel = `brand/logo.${logo.ext}`;
    mkdirSync(dirname(join(outDir, "public", rel)), { recursive: true });
    writeFileSync(join(outDir, "public", rel), logo.bytes);
    writeFileSync(
      join(outDir, "src/brand.ts"),
      `// turbineh:generated\n/** Client brand (written by the assembler). The logo is served from /public. */\nexport const BRAND: { logo: string | null } = { logo: ${JSON.stringify(`/${rel}`)} };\n`,
    );
    applied.logo = `public/${rel}`;
  }
  return applied;
}

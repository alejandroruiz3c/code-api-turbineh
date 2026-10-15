import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  font?: BrandFont | undefined;
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

/** Theme tokens written into the `@theme` block of src/app/globals.css (every screen uses only these). */
export type ThemeTokens = Record<
  | "surface"
  | "panel"
  | "subtle"
  | "ink"
  | "muted"
  | "line"
  | "field"
  | "brand"
  | "brand-contrast"
  | "accent"
  | "danger"
  | "danger-contrast"
  | "danger-soft"
  | "success"
  | "warning"
  | "warning-soft"
  | "info"
  | "info-soft",
  string
> & { font: string };

/** Defaults (light slate theme): identical to the template's globals.css. */
export const DEFAULT_TOKENS: ThemeTokens = {
  surface: "#f8fafc",
  panel: "#ffffff",
  subtle: "#f1f5f9",
  ink: "#0f172a",
  muted: "#475569",
  line: "#e2e8f0",
  field: "#cbd5e1",
  brand: "#0f172a",
  "brand-contrast": "#ffffff",
  accent: "#0f172a",
  danger: "#b91c1c",
  "danger-contrast": "#ffffff",
  "danger-soft": "#fef2f2",
  success: "#047857",
  warning: "#92400e",
  "warning-soft": "#fffbeb",
  info: "#1e40af",
  "info-soft": "#eff6ff",
  font: BRAND_FONTS.system,
};

/** Palette stated in the request (compiler, deterministic): background, accents, call-to-action, text, type. */
export interface PromptPalette {
  background?: string | undefined;
  accent?: string | undefined;
  cta?: string | undefined;
  text?: string | undefined;
  font?: BrandFont | undefined;
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
const toHex = (c: readonly number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
/** `a` moved towards `b` by `t` (0..1). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + ((y[i] ?? 0) - v) * t));
};
export const isDark = (hex: string) => contrastText(hex) === "#ffffff";

/**
 * `color` adjusted (towards white on dark backgrounds, towards black on light ones) until it reaches `min` WCAG
 * contrast on `bg`. Unchanged when it already does.
 */
export function readable(color: string, bg: string, min = 4.5): string {
  const target = isDark(bg) ? "#ffffff" : "#000000";
  for (let step = 0; step <= 20; step++) {
    const c = mix(color, target, step / 20);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return target;
}

/**
 * Complete theme from the request's palette and the uploaded brand (the upload wins for the brand colour and font).
 * Surfaces, borders and muted text are derived from the background; text meets WCAG AA (4.5:1) on the page and on
 * panels; status colours are adjusted for dark backgrounds.
 */
export function themeTokens(
  palette: PromptPalette | null | undefined,
  brand?: Brand | null,
): ThemeTokens {
  const t: ThemeTokens = { ...DEFAULT_TOKENS };
  const p = palette ?? {};
  if (p.background) {
    const bg = p.background;
    const dark = isDark(bg);
    t.surface = bg;
    t.panel = dark
      ? mix(bg, "#ffffff", 0.07)
      : bg === "#ffffff"
        ? "#ffffff"
        : mix(bg, "#ffffff", 0.6);
    t.subtle = dark ? mix(bg, "#ffffff", 0.13) : mix(bg, "#000000", 0.04);
    const inkBase = p.text ?? (dark ? "#ffffff" : DEFAULT_TOKENS.ink);
    t.ink = readable(readable(inkBase, t.surface, 7), t.panel, 7);
    t.muted = readable(readable(mix(t.ink, bg, 0.3), t.panel), t.surface);
    t.line = mix(bg, t.ink, dark ? 0.2 : 0.12);
    t.field = mix(bg, t.ink, dark ? 0.4 : 0.25);
    t["danger-soft"] = mix(bg, "#ef4444", dark ? 0.18 : 0.06);
    t["warning-soft"] = mix(bg, "#f59e0b", dark ? 0.18 : 0.08);
    t["info-soft"] = mix(bg, "#3b82f6", dark ? 0.18 : 0.06);
    const softOf = { danger: "danger-soft", warning: "warning-soft", info: "info-soft" } as const;
    for (const k of ["danger", "success", "warning", "info"] as const) {
      // Readable on panels, on the page and on its own soft background.
      const soft = k === "success" ? t.panel : t[softOf[k]];
      t[k] = readable(readable(readable(DEFAULT_TOKENS[k], t.panel), t.surface), soft);
    }
    t["danger-contrast"] = contrastText(t.danger);
  } else if (p.text) {
    t.ink = readable(p.text, t.panel, 7);
  }
  const cta = brand?.primaryColor ?? p.cta ?? p.accent;
  if (cta) {
    t.brand = cta;
    t["brand-contrast"] = contrastText(cta);
  }
  // Accents are used for links, highlights and focus rings: kept as stated unless unreadable on the page.
  const accent = p.accent ?? cta;
  if (accent) t.accent = readable(accent, t.surface);
  else if (p.background) t.accent = t.ink;
  const font = brand?.font ?? p.font;
  if (font) t.font = BRAND_FONTS[font];
  return t;
}

/** The `@theme { … }` block for globals.css. */
export function themeBlock(t: ThemeTokens): string {
  const lines = Object.entries(t)
    .filter(([k]) => k !== "font")
    .map(([k, v]) => `  --color-${k}: ${v};`);
  return `@theme {\n${lines.join("\n")}\n  --font-brand: ${t.font};\n}`;
}

/**
 * Writes the theme tokens (palette from the request + uploaded brand), the logo (public/brand/) and src/brand.ts.
 * Returns what was applied.
 */
export function applyTheme(
  outDir: string,
  input: { brand?: Brand | null; palette?: PromptPalette | null },
): { tokens: ThemeTokens; color?: string; font?: BrandFont; logo?: string } {
  const { brand, palette } = input;
  const tokens = themeTokens(palette, brand);
  const applied: { tokens: ThemeTokens; color?: string; font?: BrandFont; logo?: string } = {
    tokens,
  };
  const cssPath = join(outDir, "src/app/globals.css");
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, "utf8");
    writeFileSync(cssPath, css.replace(/@theme\s*\{[^}]*\}/, themeBlock(tokens)));
  }
  if (tokens.brand !== DEFAULT_TOKENS.brand) applied.color = tokens.brand;
  const font = brand?.font ?? palette?.font;
  if (font) applied.font = font;
  const logo = brand?.logo ? decodeLogo(brand.logo) : null;
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

/** Uploaded brand only (callers without a palette). */
export function applyBrand(
  outDir: string,
  brand: Brand,
): { color?: string; font?: BrandFont; logo?: string } {
  const { color, font, logo } = applyTheme(outDir, { brand });
  return {
    ...(color ? { color } : {}),
    ...(font ? { font } : {}),
    ...(logo ? { logo } : {}),
  };
}

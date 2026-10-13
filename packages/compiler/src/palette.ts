import { z } from "zod";

/** Type families the assembler can map to local font stacks (no third-party font requests). */
export const FONT_HINTS = ["system", "geometric", "humanist", "rounded", "serif", "mono"] as const;
export type FontHint = (typeof FONT_HINTS)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}$/);

/** Visual identity stated in the prompt. Extracted by code (never by a model): only explicit colours count. */
export const paletteSchema = z.object({
  background: hex.optional(),
  /** Accents: links, highlights, focus rings, headings that should stand out. */
  accent: hex.optional(),
  /** Call-to-action / primary buttons. */
  cta: hex.optional(),
  /** Body text, when the prompt states it. */
  text: hex.optional(),
  font: z.enum(FONT_HINTS).optional(),
});
export type Palette = z.infer<typeof paletteSchema>;

type Role = "background" | "accent" | "cta" | "text";

/** Role keywords; the keyword nearest to a colour (same clause) decides its role. */
const ROLE_WORDS: [Role, RegExp][] = [
  ["cta", /\b(call[\s-]?to[\s-]?action|cta|buttons?|primary)\b/gi],
  ["background", /\b(backgrounds?|backdrop|bg|canvas|base colou?r)\b/gi],
  ["accent", /\b(accents?|highlights?|links?|secondary)\b/gi],
  ["text", /\b(text|foreground|copy|type colou?r|font colou?r)\b/gi],
];

const COLOUR =
  /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/g;

function toHex(m: RegExpMatchArray): string | null {
  if (m[1]) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return `#${h.toLowerCase()}`;
  }
  const rgb = [m[2], m[3], m[4]].map(Number);
  if (rgb.some((v) => v > 255)) return null;
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function fontHint(prompt: string): FontHint | undefined {
  const p = prompt.toLowerCase();
  if (/\b(monospace|mono)\b/.test(p)) return "mono";
  if (/\brounded\b/.test(p) && /\b(type|font|typeface|typography)\b/.test(p)) return "rounded";
  if (/\bgeometric\b/.test(p)) return "geometric";
  if (/\bhumanist\b/.test(p)) return "humanist";
  if (/\bsans[\s-]?serif\b/.test(p)) return "system";
  if (/\bserif\b/.test(p)) return "serif";
  return undefined;
}

/**
 * Palette from explicit colours in the prompt (hex or rgb()) and the role words next to them, e.g. "navy background
 * `#001A5A`, teal accents `#34D8C4`, amber call-to-action buttons `#F2B24B`, clean sans-serif type". Deterministic:
 * a colour takes the role of the nearest role keyword in its clause (before it, or right after it); colours without a
 * role fill the call-to-action, then the accent. Returns null when the prompt states no colour and no type.
 */
export function extractPalette(prompt: string): Palette | null {
  const palette: Palette = {};
  const colours = [...prompt.matchAll(COLOUR)];
  const unassigned: string[] = [];
  colours.forEach((m, i) => {
    const value = toHex(m);
    if (!value || m.index === undefined) return;
    const prevEnd = i > 0 ? (colours[i - 1]?.index ?? 0) + (colours[i - 1]?.[0].length ?? 0) : 0;
    const nextStart = colours[i + 1]?.index ?? prompt.length;
    // Clause = from the previous colour (or sentence break) to the next separator after this colour.
    const before =
      prompt
        .slice(prevEnd, m.index)
        .split(/[.;:\n]\s|[;\n]/)
        .at(-1) ?? "";
    const afterRaw = prompt.slice(m.index + m[0].length, nextStart);
    const after = afterRaw.split(/[,.;:\n(]/)[0] ?? "";
    let best: { role: Role; distance: number } | null = null;
    for (const [role, re] of ROLE_WORDS) {
      for (const k of before.matchAll(re)) {
        const distance = before.length - ((k.index ?? 0) + k[0].length);
        if (!best || distance < best.distance) best = { role, distance };
      }
      for (const k of after.matchAll(re)) {
        // Keywords after the colour count only when nothing before it does (e.g. "#001A5A background").
        const distance = 1000 + (k.index ?? 0);
        if (!best || distance < best.distance) best = { role, distance };
      }
    }
    if (best && !palette[best.role]) palette[best.role] = value;
    else if (!best) unassigned.push(value);
  });
  for (const value of unassigned) {
    if (!palette.cta) palette.cta = value;
    else if (!palette.accent) palette.accent = value;
  }
  const font = fontHint(prompt);
  if (font) palette.font = font;
  return Object.keys(palette).length > 0 ? palette : null;
}

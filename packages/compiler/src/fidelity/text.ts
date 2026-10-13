/** Small deterministic text helpers shared by the spec-fidelity extractors (ADR-0040). */

/** Words of a PascalCase / camelCase / kebab-case name, lowercased: "StageEvent" → ["stage", "event"]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** English singular of a lowercase word (good enough for entity and role nouns). */
export function singular(w: string): string {
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(us|ss)es$/.test(w)) return w.slice(0, -2);
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ch|sh|x|z|ss)es$/.test(w)) return w.replace(/es$/, "");
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** English plural of a lowercase word. */
export function plural(w: string): string {
  if (/(ss|us|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/s$/.test(w)) return w;
  return `${w}s`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regular expression source matching a noun phrase in singular or plural ("stage limit" | "stage limits"). */
export function nounPattern(words: string[]): string {
  if (words.length === 0) return "(?!)";
  const head = words[words.length - 1] ?? "";
  const lead = words.slice(0, -1).map(escape);
  const forms = [...new Set([singular(head), plural(singular(head)), head])].map(escape);
  return `\\b${[...lead, `(?:${forms.join("|")})`].join("[\\s-]+")}\\b`;
}

/** Sentences of a request (split on . ; ! ? and line breaks, keeping decimals such as "2.5" intact). */
export function sentences(prompt: string): string[] {
  return prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z"“(])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the request mentions the noun (singular or plural). */
export function mentions(text: string, words: string[]): boolean {
  return new RegExp(nounPattern(words), "i").test(text);
}

/** Lowercase, collapse whitespace. */
export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  fifty: 50,
  hundred: 100,
};

/** "five" → 5, "12" → 12; NaN when neither. */
export const toNumber = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);

/** Items of an inline list: "pending, received and approved" → ["pending", "received", "approved"]. */
export function listItems(raw: string): string[] {
  return raw
    .split(/,|\bor\b|\band\b|\/|;/)
    .map((s) => s.trim().replace(/^the\s+/i, ""))
    .filter((s) => s.length > 0 && s.length <= 40);
}

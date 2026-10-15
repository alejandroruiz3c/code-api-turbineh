/** Deterministic naming helpers for generated code. */

export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

/** Words that are already plural or have no plural form ("Stats", "Settings", "Data"). */
const UNCOUNTABLE = new Set(["data", "info", "news", "series", "species", "equipment", "feedback"]);

export function pluralize(word: string): string {
  if (UNCOUNTABLE.has(word)) return word;
  if (/(ss|us|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/is$/.test(word)) return `${word.slice(0, -2)}es`;
  // Any other trailing "s" is taken as already plural (stats, settings, analytics).
  if (/s$/.test(word)) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export const pascal = (name: string) =>
  words(name)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
export const camel = (name: string) => {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
};
export const snake = (name: string) => words(name).join("_");
export const kebab = (name: string) => words(name).join("-");
export const label = (name: string) => {
  const w = words(name).join(" ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Names for one entity across layers. */
export function entityNames(entityName: string) {
  const ws = words(entityName);
  const last = ws[ws.length - 1] ?? "";
  const pluralWords = [...ws.slice(0, -1), pluralize(last)];
  return {
    pascal: pascal(entityName),
    table: pluralWords.join("_"),
    slug: pluralWords.join("-"),
    variable: camel(pluralWords.join(" ")),
    labelSingular: label(entityName),
    labelPlural: label(pluralWords.join(" ")),
  };
}

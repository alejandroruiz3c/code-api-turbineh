import { eng, removeStopwords, spa } from "stopword";

const LISTS = { en: eng, es: spa } as const;

/** Keywords of a text: lower-cased words without stopwords or very short tokens (for keyword search and tags). */
export function keywords(text: string, lang: keyof typeof LISTS = "en"): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  return [...new Set(removeStopwords(words, LISTS[lang]))];
}

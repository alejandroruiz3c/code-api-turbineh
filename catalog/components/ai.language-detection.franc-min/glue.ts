import { franc } from "franc-min";

/** ISO 639-3 language of a text ("eng", "spa"…), or null when it is too short or undetermined. */
export function detectLanguage(text: string, minLength = 20): string | null {
  const t = text.trim();
  if (t.length < minLength) return null;
  const lang = franc(t.slice(0, 5000));
  return lang === "und" ? null : lang;
}

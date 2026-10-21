/** What the contact email is for, shown next to every field that asks for it (ADR-0074). */
export const EMAIL_PURPOSE =
  "Only to tell you when something you asked for that the library doesn't cover yet becomes available. Only TurbineH staff see it; it is never shared.";

/** Same rule as the server (`isEmailAddress`): one @, a dot in the domain, no spaces or quotes. */
export const looksLikeEmail = (v: string): boolean =>
  v.trim().length <= 254 && /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/.test(v.trim());

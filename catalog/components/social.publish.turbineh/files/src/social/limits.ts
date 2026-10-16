import type { Network } from "./networks";

/**
 * Per-network format rules (component social.publish.turbineh), enforced before a post is saved and again before it is
 * sent. Nothing is cut silently: a text over a network's limit is refused with its count, so the person (or the AI
 * draft step) writes a version for that network.
 */
export interface NetworkRules {
  label: string;
  /** Longest text, counted the way the network counts it. */
  maxLength: number;
  /** "weighted": X's count (URLs = 23, most CJK and emoji = 2); "chars": Unicode code points. */
  counting: "weighted" | "chars";
  /** An image is required (Instagram has no text-only posts). */
  imageRequired: boolean;
  /** Images can be attached. */
  imageSupported: boolean;
  maxHashtags: number | null;
  maxMentions: number | null;
}

export const RULES: Record<Network, NetworkRules> = {
  linkedin: {
    label: "LinkedIn",
    maxLength: 3000,
    counting: "chars",
    imageRequired: false,
    imageSupported: true,
    maxHashtags: null,
    maxMentions: null,
  },
  facebook: {
    label: "Facebook",
    maxLength: 63206,
    counting: "chars",
    imageRequired: false,
    imageSupported: true,
    maxHashtags: null,
    maxMentions: null,
  },
  instagram: {
    label: "Instagram",
    maxLength: 2200,
    counting: "chars",
    imageRequired: true,
    imageSupported: true,
    maxHashtags: 30,
    maxMentions: 20,
  },
  x: {
    label: "X",
    maxLength: 280,
    counting: "weighted",
    imageRequired: false,
    imageSupported: true,
    maxHashtags: null,
    maxMentions: null,
  },
};

/** Code points X counts as 1 (twitter-text v3 ranges); everything else counts 2. */
const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
/** X shortens every link to a t.co URL of this many characters. */
export const X_URL_LENGTH = 23;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Length of a text as X counts it (weighted, max 280): URLs count 23, emoji 2, CJK 2, Latin 1. */
export function weightedLength(text: string): number {
  const normalized = text.normalize("NFC");
  let total = 0;
  let rest = normalized;
  for (const m of normalized.matchAll(URL_RE)) {
    total += X_URL_LENGTH;
    rest = rest.replace(m[0], " ");
    total -= 1;
  }
  for (const { segment } of segmenter.segment(rest)) {
    if (EMOJI.test(segment)) {
      total += 2;
      continue;
    }
    for (const ch of segment) {
      const cp = ch.codePointAt(0) ?? 0;
      total += LIGHT_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
    }
  }
  return total;
}

export function textLength(text: string, network: Network): number {
  return RULES[network].counting === "weighted"
    ? weightedLength(text)
    : [...text.normalize("NFC")].length;
}

const hashtags = (text: string) => text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
const mentions = (text: string) => text.match(/(^|\s)@[\w.]+/g)?.length ?? 0;

export interface Problem {
  network: Network;
  message: string;
}

/** Every reason a post cannot go to a network as written; [] when it can. */
export function checkPost(
  network: Network,
  post: { text: string; imageUrl?: string | null },
): Problem[] {
  const r = RULES[network];
  const out: Problem[] = [];
  const text = post.text.trim();
  const length = textLength(text, network);
  if (!text && !(network === "instagram" && post.imageUrl))
    out.push({ network, message: `${r.label}: write the text of the post.` });
  if (length > r.maxLength)
    out.push({
      network,
      message: `${r.label}: ${length}/${r.maxLength} characters${r.counting === "weighted" ? " (as X counts them: links 23, emoji 2)" : ""}. Write a shorter version for ${r.label}.`,
    });
  if (r.imageRequired && !post.imageUrl)
    out.push({ network, message: `${r.label}: an image is required (no text-only posts).` });
  if (post.imageUrl && !r.imageSupported)
    out.push({ network, message: `${r.label}: images are not supported here.` });
  if (r.maxHashtags !== null && hashtags(text) > r.maxHashtags)
    out.push({ network, message: `${r.label}: at most ${r.maxHashtags} hashtags.` });
  if (r.maxMentions !== null && mentions(text) > r.maxMentions)
    out.push({ network, message: `${r.label}: at most ${r.maxMentions} @mentions.` });
  if (post.imageUrl && !/^https:\/\/[^\s]+$/i.test(post.imageUrl))
    out.push({ network, message: `${r.label}: the image must be a public https:// URL.` });
  return out;
}

/** Validates a composition (one text, optional per-network versions) against every chosen network's rules. */
export function compositionProblems(
  input: { text: string; versions: Partial<Record<Network, string>>; imageUrl: string | null },
  networks: Network[],
): Problem[] {
  return networks.flatMap((n) =>
    checkPost(n, { text: input.versions[n] ?? input.text, imageUrl: input.imageUrl }),
  );
}

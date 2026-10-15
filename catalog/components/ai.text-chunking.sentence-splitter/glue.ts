import { split, SentenceSplitterSyntax } from "sentence-splitter";

/** Sentences of a text (abbreviations and quotes handled by the splitter). */
export function sentences(text: string): string[] {
  return split(text)
    .filter((n) => n.type === SentenceSplitterSyntax.Sentence)
    .map((n) => n.raw.trim())
    .filter(Boolean);
}

/**
 * Chunks for retrieval (RAG) or map-reduce summaries: whole sentences up to `maxChars`, overlapping by
 * `overlapSentences`. A single sentence longer than `maxChars` is cut at the limit.
 */
export function chunkText(
  text: string,
  opts: { maxChars?: number; overlapSentences?: number } = {},
): string[] {
  const max = opts.maxChars ?? 2000;
  const overlap = Math.max(0, opts.overlapSentences ?? 1);
  const all = sentences(text).flatMap((s) =>
    s.length <= max ? [s] : (s.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? []),
  );
  const chunks: string[] = [];
  let start = 0;
  while (start < all.length) {
    let end = start;
    let size = 0;
    while (end < all.length && size + (all[end]?.length ?? 0) + 1 <= max) {
      size += (all[end]?.length ?? 0) + 1;
      end++;
    }
    if (end === start) end = start + 1;
    chunks.push(all.slice(start, end).join(" "));
    if (end >= all.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

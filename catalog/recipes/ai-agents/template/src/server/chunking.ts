/** Knowledge base limits (recipe ai-agents). */
export const KNOWLEDGE_LIMITS = {
  maxChars: 200_000,
  maxChunks: 300,
  chunkSize: 900,
  overlap: 120,
} as const;

/**
 * Splits a document into overlapping chunks on paragraph boundaries (long paragraphs are cut by length), so each
 * embedding covers one coherent passage and an answer can cite where it came from.
 */
export function chunkText(
  text: string,
  size: number = KNOWLEDGE_LIMITS.chunkSize,
  overlap: number = KNOWLEDGE_LIMITS.overlap,
): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) pieces.push(p);
    else for (let i = 0; i < p.length; i += size - overlap) pieces.push(p.slice(i, i + size));
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      chunks.push(current);
      current = current.slice(-overlap);
      current = current.includes(" ") ? current.slice(current.indexOf(" ") + 1) : "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks.slice(0, KNOWLEDGE_LIMITS.maxChunks);
}

import removeMd from "remove-markdown";

/** Plain text from Markdown (SMS, notifications, speech). Not a sanitizer: escape before rendering as HTML. */
export function markdownToPlainText(markdown: string): string {
  return removeMd(markdown).trim();
}

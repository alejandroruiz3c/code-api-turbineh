import { extractText, getDocumentProxy } from "unpdf";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Text of a PDF upload, page by page (no OCR: scanned PDFs return empty pages). Bounded size and page count. */
export async function pdfToText(
  data: Uint8Array,
  opts: { maxPages?: number } = {},
): Promise<{ pages: string[]; totalPages: number }> {
  if (data.byteLength > MAX_PDF_BYTES) throw new Error("PDF is too large");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { pages: text.slice(0, opts.maxPages ?? 500), totalPages };
}

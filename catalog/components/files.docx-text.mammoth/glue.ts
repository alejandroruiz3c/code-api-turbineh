import mammoth from "mammoth";

const MAX_DOCX_BYTES = 20 * 1024 * 1024;

/** Plain text of a Word .docx upload (bounded size; rejects files that are not .docx). */
export async function docxToText(data: Buffer): Promise<string> {
  if (data.byteLength > MAX_DOCX_BYTES) throw new Error("Document is too large");
  const { value } = await mammoth.extractRawText({ buffer: data });
  return value.trim();
}

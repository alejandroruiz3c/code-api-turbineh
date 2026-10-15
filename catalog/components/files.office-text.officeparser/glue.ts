import { OfficeParser } from "officeparser";

const MAX_OFFICE_BYTES = 30 * 1024 * 1024;

/** Plain text of an Office/OpenDocument upload (pptx, xlsx, docx, odt…). Bounded size. */
export async function officeToText(data: Buffer): Promise<{ type: string; text: string }> {
  if (data.byteLength > MAX_OFFICE_BYTES) throw new Error("Document is too large");
  const ast = await OfficeParser.parseOffice(data);
  const { value } = await ast.to("text");
  return { type: String(ast.type), text: String(value).trim() };
}

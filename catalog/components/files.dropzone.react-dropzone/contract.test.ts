import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { useDropzone } from "react-dropzone";
function Drop() {
  const { getRootProps, getInputProps } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxSize: 5_000_000,
  });
  return h("div", getRootProps(), h("input", getInputProps()), "Drop files");
}
describe("react-dropzone contract", () => {
  it("renders a drop area with a file input", () => {
    const html = renderToString(h(Drop));
    expect(html).toContain('type="file"');
    expect(html).toContain("Drop files");
  });
});

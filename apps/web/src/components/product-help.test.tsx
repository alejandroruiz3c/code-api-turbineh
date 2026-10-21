import { productHelpResponse, USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductHelpPanel } from "./product-help";

vi.mock("next/navigation", () => ({ useRouter: () => ({}), useSearchParams: () => null }));
const { helpOf } = await import("./flow-wizard");

describe("product question on the web (ADR-0069)", () => {
  it("shows what TurbineH builds with one example per use case, as clickable suggestions", () => {
    const { help } = productHelpResponse();
    const html = renderToStaticMarkup(<ProductHelpPanel help={help} onPick={() => undefined} />);
    expect(html).toContain('data-testid="product-help"');
    for (const u of USE_CASES) expect(html).toContain(u.name);
    expect(html.match(/<button/g)).toHaveLength(USE_CASES.length);
    expect(html).toContain("Nothing was built");
  });

  it("recognises the API's help answer, never a plan or a build", () => {
    expect(helpOf(productHelpResponse())?.useCases.length).toBe(USE_CASES.length);
    expect(helpOf({ id: "p1", state: "planned" })).toBeNull();
    expect(helpOf({ build_id: "b1" })).toBeNull();
  });
});

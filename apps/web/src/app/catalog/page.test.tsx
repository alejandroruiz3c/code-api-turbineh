import { CATALOG_TOTALS, USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { default: Catalog } = await import("./page");

const render = async (q?: string) =>
  renderToStaticMarkup(await Catalog({ searchParams: Promise.resolve(q ? { q } : {}) }));

describe("/catalog page", () => {
  it("lists every complete flow from the engine (catalogue recipes, not hard-coded)", async () => {
    const html = await render();
    expect(USE_CASES.length).toBeGreaterThan(0);
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const u of USE_CASES) {
      expect(html.replace(/&amp;/g, "&")).toContain(u.name);
      expect(html).toContain(`/flows/new?capability=${encodeURIComponent(u.id)}`);
    }
  });

  it("each flow shows its verified functions and the components that extend it (ADR-0076)", async () => {
    const html = await render();
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'");
    for (const u of USE_CASES) {
      expect(html).toContain(`id="${u.id}"`);
      expect(text).toContain(u.tagline);
      for (const f of u.functions) expect(text, `${u.id}: ${f}`).toContain(f);
      for (const a of u.addOns) {
        expect(html).toContain(`href="/discover?q=${encodeURIComponent(a.id)}"`);
        expect(text).toContain(a.tagline);
        for (const f of a.functions) expect(text, `${a.id}: ${f}`).toContain(f);
      }
    }
    // Areas that had no sections before (bookings, saas-crud, internal-tool) now list what they do.
    for (const id of ["bookings", "saas-crud", "internal-tool"])
      expect(USE_CASES.find((u) => u.id === id)?.functions.length).toBeGreaterThan(2);
    expect(text.replace(/\s+/g, " ")).toContain(
      `${CATALOG_TOTALS.components} verified components · ${CATALOG_TOTALS.useCases} complete use cases · ${CATALOG_TOTALS.functions} functions proved by tests`,
    );
  });

  it("never names the decider or model vendors", async () => {
    const text = (await render()).replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(
      /\b(JEV|TypeSafe|quyet|OpenAI|Anthropic|Mistral|Qwen|Llama|DeepSeek|Gemini|GPT-\d)/i,
    );
  });

  it("sends an old /catalog?q= search to Discover", async () => {
    await expect(render("shop")).rejects.toThrow("redirect:/discover?q=shop");
  });
});

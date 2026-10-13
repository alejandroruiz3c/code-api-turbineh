import { USE_CASES } from "@turbineh/engine";
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
      expect(html).toContain(u.name);
      expect(html).toContain(`/flows/new?capability=${encodeURIComponent(u.id)}`);
    }
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

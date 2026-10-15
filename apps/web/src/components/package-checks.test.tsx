import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PackageChecks } from "./package-checks";

const html = renderToStaticMarkup(<PackageChecks />);
const text = html.replace(/<[^>]+>/g, " ");

describe("home: checks every package passes", () => {
  it("is a labelled section with 3 to 5 checks across the three areas", () => {
    expect(html).toMatch(/<section[^>]*aria-labelledby="checks-title"/);
    const items = html.match(/<li/g) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const area of ["Cybersecurity", "AI safety", "Code quality"]) expect(text).toContain(area);
  });

  it("hides decorative icons from assistive technology", () => {
    for (const svg of html.match(/<svg[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
  });

  it("states no figures and names no model vendor", () => {
    expect(text).not.toMatch(/\d+\s?%|\b\d{2,}\b/);
    expect(text).not.toMatch(
      /\b(JEV|TypeSafe|quyet|OpenAI|Anthropic|Mistral|Qwen|Llama|DeepSeek|Gemini|GPT-\d)/i,
    );
  });
});

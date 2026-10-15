import { z } from "zod";
import { describe, expect, it } from "vitest";
import { normalizeFaq } from "./build-spec.js";
import { PARTS } from "./parts.js";

const site = {
  tagline: "Freshly roasted coffee",
  hero_subtitle: "Small-batch beans and brewing gear.",
  features: [1, 2, 3].map((i) => ({ title: `Feature ${i}`, text: "Some benefit text." })),
  steps: [1, 2, 3].map((i) => ({ title: `Step ${i}`, text: "Some step text." })),
  services: [1, 2, 3].map((i) => ({ title: `Service ${i}`, text: "Some service text." })),
  about: "Northwind Coffee Roasters is a small roastery.",
  cta: "Shop now",
};

describe("site FAQ (S2: questions and answers never swapped)", () => {
  it("swaps items whose answer is the question (Frontiers shop output)", () => {
    expect(
      normalizeFaq([
        {
          q: "We roast in small batches to ensure peak flavour.",
          a: "How fresh is your coffee?",
        },
        { q: "Do you ship internationally?", a: "Currently we ship domestically only." },
      ]),
    ).toEqual([
      { q: "How fresh is your coffee?", a: "We roast in small batches to ensure peak flavour." },
      { q: "Do you ship internationally?", a: "Currently we ship domestically only." },
    ]);
  });

  it("asks the model for explicit question/answer keys and maps them to q/a in code", () => {
    const schema = z.toJSONSchema(PARTS.site.schema, {
      target: "draft-7",
      io: "input",
    }) as unknown as {
      properties: { faq: { items: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(schema.properties.faq.items.properties).sort()).toEqual([
      "answer",
      "question",
    ]);
    const parsed = PARTS.site.schema.parse({
      ...site,
      faq: [
        { question: "How fresh is your coffee?", answer: "Roasted this week." },
        { question: "We ship to the EU only.", answer: "Do you ship internationally?" },
        { question: "What gear do you carry?", answer: "Grinders, scales and kettles." },
      ],
    });
    expect(parsed.faq).toEqual([
      { q: "How fresh is your coffee?", a: "Roasted this week." },
      { q: "Do you ship internationally?", a: "We ship to the EU only." },
      { q: "What gear do you carry?", a: "Grinders, scales and kettles." },
    ]);
    expect(parsed.faq.every((f) => f.q.endsWith("?"))).toBe(true);
  });
});

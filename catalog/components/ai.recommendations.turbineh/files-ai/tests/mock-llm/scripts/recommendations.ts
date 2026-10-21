import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MockScript } from "../mock";

/**
 * Scripted model behaviour for the recommendation toolkit (component ai.recommendations.turbineh): plain-language
 * messages become the same tool calls a real model would make, so E2E tests exercise the real tools, the database
 * and the confirmation step — without internet. Needs are read from this app's src/recommendations/params.json.
 */
type Field = { key: string; label: string; type: string; options?: string[] };
const fields = (): Field[] => {
  try {
    return (
      JSON.parse(readFileSync(join(process.cwd(), "src/recommendations/params.json"), "utf8")) as {
        fields: Field[];
      }
    ).fields;
  } catch {
    return [];
  }
};

const REF = /\b([A-Z]{1,6}-[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,8})?)\b/g;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const TIME = /\b(\d{2}:\d{2})\b/;
// An address, or the placeholder the AI Safety Pack shows the model instead of it ("[email-1]", ADR-0072).
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\[email-\d+\]/;
const refs = (t: string) => [...t.matchAll(REF)].map((m) => m[1] as string);
const pick = (re: RegExp, t: string) => re.exec(t)?.[1];
const word = (s: string) => s.toLowerCase().replace(/\s*\(.*\)$/, "");

const script: MockScript = {
  id: "recommendations",
  rules: [
    {
      tool: "book_viewing",
      when: /\b(viewing|visit)\b/i,
      args: (t) => {
        const [reference] = refs(t);
        const email = EMAIL.exec(t)?.[0];
        const [date, time] = [pick(DATE, t), pick(TIME, t)];
        const name = /\bfor ([^,<]+?)\s*,/i.exec(t)?.[1]?.trim();
        return reference && email && date && time && name
          ? { reference, date, time, name, email }
          : null;
      },
    },
    {
      tool: "compare_items",
      when: /\bcompare\b/i,
      args: (t) => (refs(t).length >= 2 ? { references: refs(t) } : null),
    },
    {
      tool: "item_details",
      when: /\b(tell me about|details|how many|does|is there|describe)\b/i,
      args: (t) => {
        const [reference] = refs(t);
        return reference ? { reference } : null;
      },
    },
    {
      tool: "save_preferences",
      when: /\b(budget|looking for|i need|we need|prefer|i want)\b/i,
      args: (t) => {
        const out: Record<string, unknown> = {};
        const budget = /\bbudget\b[^\d]{0,20}([\d][\d,.]*)\s*(k\b)?/i.exec(t);
        if (budget?.[1]) {
          const n = Number(budget[1].replace(/[,.](?=\d{3}\b)/g, "").replace(",", "."));
          out.budgetMax = budget[2] ? n * 1000 : n;
        }
        const loc = /\bin ([\p{Lu}][\p{L}' -]{1,60}?)(?=[,.;]|\s+with\b|\s+and\b|$)/u.exec(t);
        if (loc?.[1]) out.location = loc[1].trim();
        const needs: Record<string, unknown> = {};
        for (const f of fields()) {
          if (f.type === "integer" || f.type === "number") {
            const m = new RegExp(
              `(\\d+(?:\\.\\d+)?)\\s+(?:or more\\s+)?${word(f.label)}`,
              "i",
            ).exec(t);
            if (m?.[1]) needs[f.key] = Number(m[1]);
          } else if (f.type === "enum") {
            const o = f.options?.find((x) => new RegExp(`\\b${x}\\b`, "i").test(t));
            if (o) needs[f.key] = o;
          }
        }
        if (Object.keys(needs).length) out.needs = needs;
        return Object.keys(out).length ? out : null;
      },
    },
    {
      tool: "recommend_items",
      when: /\b(recommend|suggest|match|show me|options)\b/i,
      args: () => ({}),
    },
  ],
  render: {
    save_preferences: (r) => String(r.message ?? "Noted."),
    recommend_items: (r) => {
      const matches = (r.matches ?? []) as {
        reference: string;
        title: string;
        price: string;
        location: string;
        facts: Record<string, unknown>;
      }[];
      if (matches.length === 0) return String(r.message ?? "No match.");
      return `Matches for ${String(r.preferences)}:\n${matches
        .map(
          (m) =>
            `- ${m.reference}: ${m.title} — ${m.price} — ${m.location} — ${Object.entries(m.facts)
              .map(([k, v]) => `${k} ${String(v ?? "—")}`)
              .join(", ")}`,
        )
        .join("\n")}`;
    },
    item_details: (r) => {
      const facts = (r.facts ?? []) as { label: string; value: string }[];
      return [
        `${String(r.reference)} · ${String(r.title)}`,
        ...facts.map((f) => `${f.label}: ${f.value}`),
        String(r.description ?? ""),
      ].join("\n");
    },
    compare_items: (r) => `${String(r.table)}\nSide by side: ${String(r.link)}`,
  },
};

export default script;

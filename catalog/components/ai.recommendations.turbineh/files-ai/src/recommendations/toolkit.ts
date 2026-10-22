import { z } from "zod";
import { defineTool, ToolError, type Toolkit } from "@/lib/ai/agent";
import { recommendationConfig as cfg } from "./config";
import {
  compareLink,
  compareText,
  facts,
  formatMoney,
  mergePreferences,
  preferencesSchema,
  referenceSchema,
  type CatalogItem,
  type Preferences,
} from "./search";
import { preferencesOf, publishedByReference, recommend, savePreferences } from "./store";
import { VIEWING_TOOLS } from "./viewing";

/**
 * Conversational recommendations as tools for runAgent (component ai.recommendations.turbineh, ADR-0072). The model
 * only chooses which tool to call: preferences are validated and stored, matching and ranking are code over the
 * database, and every fact it may repeat comes from a verified record. Nothing is invented: unknown references are
 * refused, and "no match" is said as such.
 */
const item = cfg.item.singular;
const items = cfg.item.plural;

const brief = (i: CatalogItem) => ({
  reference: i.reference,
  title: i.title,
  price: formatMoney(i.price, i.currency),
  location: i.location,
  facts: Object.fromEntries(cfg.fields.map((f) => [f.label, i.attributes[f.key] ?? null])),
});

const describe = (p: Preferences) =>
  [
    p.budgetMax !== null ? `budget up to ${formatMoney(p.budgetMax, cfg.currency)}` : null,
    p.location ? `location ${p.location}` : null,
    ...cfg.fields
      .filter((f) => p.needs[f.key] !== undefined)
      .map(
        (f) =>
          `${f.label.toLowerCase()} ${f.match === "min" ? "at least " : f.match === "max" ? "at most " : ""}${String(p.needs[f.key])}`,
      ),
  ]
    .filter(Boolean)
    .join(", ") || "no preferences yet";

const savePreferencesTool = defineTool({
  name: "save_preferences",
  description: `Record what the ${cfg.customer.singular} says they want: budget (highest price in ${cfg.currency}), preferred location and needs (${cfg.fields.map((f) => f.key).join(", ") || "none configured"}). Call it whenever they state or change one; earlier answers are kept.`,
  parameters: preferencesSchema(cfg),
  execute: async (a, ctx) => {
    const merged = mergePreferences(await preferencesOf(ctx.userId), a);
    await savePreferences(ctx.userId, merged);
    return { saved: true, preferences: merged, message: `Noted: ${describe(merged)}.` };
  },
});

const recommendTool = defineTool({
  name: "recommend_items",
  description: `Recommend ${items} from the verified catalogue that fit the recorded preferences (budget, location, needs). Only these results exist: never mention a ${item} this tool did not return.`,
  parameters: z.object({}).strict(),
  execute: async (_a, ctx) => {
    const prefs = await preferencesOf(ctx.userId);
    const found = await recommend(prefs);
    return {
      preferences: describe(prefs),
      matches: found.map(brief),
      message: found.length
        ? undefined
        : `No verified ${item} fits ${describe(prefs)}. Changing the budget, the location or a need may help.`,
    };
  },
});

const detailsTool = defineTool({
  name: "item_details",
  description: `The verified facts of one ${item} by its reference (price, location, ${cfg.fields.map((f) => f.label.toLowerCase()).join(", ")}, description). Use it to answer any question about a ${item}; if a fact is not listed, say it is not published.`,
  parameters: z.object({ reference: referenceSchema }).strict(),
  execute: async (a) => {
    const { items: found } = await publishedByReference([a.reference]);
    const i = found[0];
    if (!i) throw new ToolError(`No published ${item} has the reference ${a.reference}.`);
    return {
      reference: i.reference,
      title: i.title,
      facts: facts(i, cfg),
      description: i.description || "No description published.",
    };
  },
});

const compareTool = defineTool({
  name: "compare_items",
  description: `Compare 2 to 4 ${items} side by side by their references (same facts, one column each) and give the link to the comparison page.`,
  parameters: z.object({ references: z.array(referenceSchema).min(2).max(4) }).strict(),
  execute: async (a) => {
    const { items: found, unknown } = await publishedByReference(a.references);
    if (unknown.length > 0)
      throw new ToolError(`No published ${item} has the reference ${unknown.join(", ")}.`);
    return { table: compareText(found, cfg), link: compareLink(found.map((i) => i.reference)) };
  },
});

export const toolkit: Toolkit = {
  id: "recommendations",
  title: `${items.charAt(0).toUpperCase()}${items.slice(1)} assistant`,
  audience: "public",
  greeting: `I can find ${items} that fit your budget, location and needs, answer questions about them and compare them.`,
  instructions: [
    `You help ${cfg.customer.plural} find ${items} from this business's verified catalogue, in plain language.`,
    `Ask for their budget (${cfg.currency}), preferred location and needs; record each answer with save_preferences, then use recommend_items.`,
    `Every ${item} and fact you mention must come from recommend_items, item_details or compare_items. Never invent a ${item}, a price or a feature; if something is not published, say so.`,
    "Do not give legal, mortgage or investment advice.",
  ].join("\n"),
  tools: [savePreferencesTool, recommendTool, detailsTool, compareTool, ...VIEWING_TOOLS],
};

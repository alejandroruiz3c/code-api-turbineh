import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { gateOffline } from "./gate-offline.js";
import { openDecider } from "@turbineh/decider";
import { gateDomains, planCriteria } from "./pipeline.js";
import { explainUncovered } from "./scope.js";

/**
 * Regression (ADR-0072) for AI agents over the customer's own data that production refused or built at 0 % functional
 * coverage: a mailbox triage agent with a finance spreadsheet, a property recommendation assistant that books viewings,
 * and a clinic booking agent. Synthetic, paraphrased fixtures (same kind of need, other words and names), compiled-spec
 * shaped; the gate runs exactly as the worker runs it, with code only.
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const spec = (
  s: Partial<BuildSpec> & Pick<BuildSpec, "recipe" | "acceptance_criteria">,
): BuildSpec =>
  ({
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Example",
    slug: "example",
    summary: "An example app compiled from a request.",
    roles: ["owner"],
    entities: [],
    pages: [{ path: "/", purpose: "Home page", auth_required: false }],
    capabilities: ["security.headers"],
    ...s,
  }) as BuildSpec;

async function gate(prompt: string, s: BuildSpec) {
  const { verdict, proven, spec: out } = await gateOffline(prompt, s, root);
  const plan = planCriteria(
    out.acceptance_criteria,
    join(root, "catalog/recipes"),
    out.recipe,
    gateDomains(out, prompt),
    {
      entities: out.entities,
      roles: out.roles,
      about: [out.app_name, out.summary, ...(out.request_words ?? [])],
    },
  );
  return { verdict, proven, out, plan, domains: gateDomains(out, prompt) };
}

describe("AI agents over the customer's data are covered with verified functions (ADR-0072)", () => {
  it("a mailbox assistant that prioritises mail, sends a morning summary and logs bills to a finance spreadsheet", async () => {
    const prompt =
      "I need assistants that go through the emails I receive, sort each one by how important it is and send me a " +
      "short morning summary of what I must answer. When a message is a bill or a payment they should log it in a " +
      "spreadsheet of my money: what comes in, what goes out and what I invest.";
    const r = await gate(
      prompt,
      spec({
        recipe: "ai-agents",
        app_name: "Inbox Butler",
        summary:
          "Agents that triage incoming mail and log bills and payments to a money spreadsheet.",
        roles: ["owner"],
        entities: [
          { name: "Email", fields: [{ name: "subject", type: "string", required: true }] },
          {
            name: "FinancialRecord",
            fields: [{ name: "amount", type: "decimal", required: true }],
          },
        ],
        acceptance_criteria: [
          "Given a new email arrives, when the agents process it, then it is assigned a priority level.",
          "Given the received emails, when the daily update is generated, then it contains only the highest priority emails.",
          "Given an email is a bill or a payment, when the agent processes it, then the financial data is extracted.",
          "Given the spreadsheet is updated, when the user opens it, then income, expenses and investments are reflected.",
        ],
      }),
    );
    expect(r.domains).toEqual(["ai.mail-triage.turbineh", "jobs.scheduled.turbineh"]);
    expect(r.verdict.status).toBe("covered");
    expect(r.out.acceptance_criteria.filter((c) => !r.proven.has(c))).toEqual([]);
    expect(r.plan.every((c) => c.status === "covered")).toBe(true);
    expect(r.plan.flatMap((c) => c.canonical ?? [])).toEqual(
      expect.arrayContaining([
        "mail-triage.classify-priority",
        "mail-triage.daily-digest",
        "mail-triage.finance-extract",
        "mail-triage.excel-export",
      ]),
    );
  });

  it("a chat assistant for new apartments: preferences, verified matches, answers, comparison and a visit", async () => {
    const prompt =
      "Create a chat assistant for Marea Homes, a builder of new apartments in Alicante: it learns each buyer's " +
      "maximum budget, preferred district and how many bedrooms they want, suggests matching apartments from our " +
      "checked inventory, answers questions about any of them, lets buyers compare a few side by side and books a " +
      "visit to the show flat.";
    const r = await gate(
      prompt,
      spec({
        recipe: "ai-agents",
        app_name: "Marea Homes Assistant",
        summary:
          "A conversational assistant that matches buyers with new apartments and books visits.",
        roles: ["buyer", "sales_agent"],
        entities: [
          { name: "Property", fields: [{ name: "price", type: "decimal", required: true }] },
          {
            name: "BuyerProfile",
            fields: [{ name: "budgetMax", type: "decimal", required: true }],
          },
        ],
        acceptance_criteria: [
          "The assistant identifies and records the buyer's maximum budget during the conversation.",
          "The assistant identifies and records the buyer's preferred location during the conversation.",
          "The assistant recommends apartments that match the buyer's budget, location and needs using verified data.",
          "The assistant allows the buyer to compare two or more recommended apartments side-by-side.",
          "The assistant facilitates the booking of a visit for a selected apartment.",
        ],
      }),
    );
    expect(r.domains).toEqual(["domain.bookings.turbineh", "ai.recommendations.turbineh"]);
    expect(r.verdict.status).toBe("covered");
    expect(r.out.acceptance_criteria.filter((c) => !r.proven.has(c))).toEqual([]);
    expect(
      r.plan.filter((c) => c.status === "covered").length / r.plan.length,
    ).toBeGreaterThanOrEqual(0.8);
  });

  it("an AI booking agent for a dental practice: availability, a re-check before booking, the booking, a taken time", async () => {
    const prompt =
      "An AI agent for a dental practice that finds free 30-minute slots in plain language and books check-ups, never twice";
    const r = await gate(
      prompt,
      spec({
        recipe: "ai-agents",
        app_name: "Smile Desk",
        summary: "An AI booking agent for check-ups at a dental practice.",
        roles: ["patient", "receptionist"],
        entities: [
          {
            name: "Appointment",
            fields: [{ name: "startTime", type: "datetime", required: true }],
          },
        ],
        acceptance_criteria: [
          "Given a user asks for an appointment, the agent must query the practice's calendar to identify available 30-minute time slots.",
          "Given a user picks a time slot, the agent must verify the slot is still available before proceeding to booking.",
          "Given a user requests a time that is already occupied, the agent must inform the user and suggest the next available slot.",
        ],
      }),
    );
    expect(r.domains).toEqual(["domain.bookings.turbineh"]);
    expect(r.verdict.status).toBe("covered");
    expect(r.plan.every((c) => c.status === "covered")).toBe(true);
    expect(r.plan.flatMap((c) => c.canonical ?? [])).toContain("bookings.assistant-taken");
  });

  it("a mailbox request on a recipe without AI selects no AI domain", async () => {
    expect(
      gateDomains(
        spec({ recipe: "saas-crud", acceptance_criteria: [] }),
        "Classify every email I receive by priority",
      ),
    ).toEqual([]);
  });

  it("outside the AI use case, the verified agents are offered as components (ADR-0062) with what they need", async () => {
    const offer = async (prompt: string, criteria: string[]) => {
      const { verdict } = await gateOffline(
        prompt,
        spec({ recipe: "saas-crud", acceptance_criteria: criteria }),
        root,
      );
      expect(verdict.status).toBe("uncovered");
      const u = await explainUncovered({
        prompt,
        verdict,
        componentsDir: join(root, "catalog/components"),
        decider: openDecider,
        planId: null,
      });
      return u.explanation.offer?.components.map((c) => c.id) ?? [];
    };
    expect(
      await offer(
        "A dashboard for my bakery where each email I receive is sorted by priority and bills go to my finances",
        [
          "Each email I receive is sorted by priority",
          "Bills in my mail are recorded in my finances",
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        "ai.mail-triage.turbineh",
        "email.inbox.imapflow",
        "ai.orchestrator.turbineh",
      ]),
    );
    expect(
      await offer("A site where a bot suggests cars that match each visitor's budget", [
        "The bot suggests cars that match the visitor's budget",
      ]),
    ).toEqual(expect.arrayContaining(["ai.recommendations.turbineh"]));
  });
});

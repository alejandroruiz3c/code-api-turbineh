import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { gateOffline } from "./gate-offline.js";

/**
 * Regression (ADR-0069) for the request classes production refused with "0 % functional coverage" although the library
 * covers them. Synthetic, paraphrased fixtures (same kind of need, other words and names), compiled-spec shaped.
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

describe("the scope gate covers what the library covers (ADR-0069)", () => {
  it("a help-desk assistant that answers from FAQ articles and hands over to a person", async () => {
    const {
      verdict,
      proven,
      spec: out,
    } = await gateOffline(
      "A help desk bot that replies using our FAQ articles and passes tricky questions to a human",
      spec({
        recipe: "ai-agents",
        app_name: "Desk Bot",
        summary: "A help desk bot answering from FAQ articles, with hand-over to a person.",
        roles: ["admin", "customer"],
        entities: [
          { name: "FaqArticle", fields: [{ name: "title", type: "string", required: true }] },
          {
            name: "EscalationTicket",
            fields: [{ name: "reason", type: "string", required: true }],
          },
        ],
        acceptance_criteria: [
          "Given a customer question, the assistant retrieves and displays a relevant FAQ article.",
          "Given a question the FAQ cannot answer, the assistant offers to escalate to a human.",
          "Given the customer chooses to escalate, the system creates a support ticket and notifies a person from the team.",
        ],
      }),
      root,
    );
    expect(verdict.status).toBe("covered");
    expect(out.acceptance_criteria.filter((c) => !proven.has(c))).toEqual([]);
  });

  it("a to-do app with projects asked in another stack: built on ours, said in the plan", async () => {
    const {
      verdict,
      proven,
      spec: out,
    } = await gateOffline(
      "Haz una app de tareas con jQuery y un archivo JSON, con animaciones chulas: tareas y proyectos que se crean, editan, borran y archivan",
      spec({
        recipe: "projects",
        app_name: "Task Grid",
        entities: [
          { name: "Project", fields: [{ name: "name", type: "string", required: true }] },
          { name: "TodoTask", fields: [{ name: "title", type: "string", required: true }] },
        ],
        acceptance_criteria: [
          "Given a project, when the user enters a task name and clicks create, then the task is saved in the JSON file.",
          "Given a task, when the user edits its text, then the change persists in the JSON file.",
          "Given a task exists, when the user clicks delete, then it is removed from the JSON file.",
          "Given a task is active, when the user archives it, then it moves to the archived section.",
          "Given an existing project, when the user renames it, then the new name is saved.",
          "Given a project exists, when the user deletes it, then the project and its tasks are removed.",
          "Given a project is active, when the user archives it, then it moves to the archived projects.",
          "Given the page is loaded, then the UI shows smooth animations and a glowing colour scheme.",
        ],
      }),
      root,
    );
    expect(verdict.status).toBe("covered");
    expect(out.acceptance_criteria.filter((c) => !proven.has(c))).toEqual([]);
    expect(out.general_requirements?.map((g) => g.kind)).toEqual(["look-and-feel", "stack"]);
    expect(out.general_requirements?.find((g) => g.kind === "stack")?.how).toMatch(
      /jQuery, a JSON file.*PostgreSQL, a database, instead of a JSON file/,
    );
  });

  it("the use case asked with general words only gets the use case's own verified functions", async () => {
    const { verdict, spec: out } = await gateOffline(
      "A runnable trackers app with demo data, verified in the TurbineH sandbox.",
      spec({
        recipe: "tracker",
        acceptance_criteria: [
          "Given the user is in the TurbineH sandbox, when they open the app, then it must be runnable.",
          "Given the app is running, when the user opens the dashboard, then they see pre-populated demo data.",
        ],
      }),
      root,
    );
    expect(verdict.status).toBe("covered");
    expect(out.acceptance_criteria.length).toBeGreaterThan(2);
    expect(out.general_requirements?.map((g) => g.kind)).toEqual(["verified", "sample-data"]);
  });

  it("a blog about AI is not refused as AI generation", async () => {
    const { verdict } = await gateOffline(
      "a minimal blog to publish notes about AI research",
      spec({
        recipe: "corporate-site",
        acceptance_criteria: [
          "The admin publishes a post that appears on the blog, RSS and sitemap",
          "Given a visitor, when they browse the site, then the home, services, about and contact pages are shown.",
        ],
      }),
      root,
    );
    expect(verdict.notCovered.filter((r) => /AI generation/.test(r.why))).toEqual([]);
    expect(verdict.status).toBe("covered");
  });

  it("precision: a request outside the library is still refused", async () => {
    const { verdict } = await gateOffline(
      "A to-do app that syncs every task with Trello and texts me by SMS",
      spec({
        recipe: "projects",
        acceptance_criteria: [
          "Given a task, when it is created, then it is synced to the user's Trello board.",
          "Given a task is due, then the user receives an SMS reminder.",
          "Given the page is loaded, then the UI uses a dark colour scheme.",
        ],
      }),
      root,
    );
    expect(verdict.status).toBe("uncovered");
  });
});

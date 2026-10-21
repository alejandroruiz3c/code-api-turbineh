import { describe, expect, it } from "vitest";
import type { BuildSpec } from "./build-spec.js";
import { generalKind, separateGeneral, stackNote } from "./general-requirements.js";

// Synthetic, paraphrased fixtures of the requests production refused (ADR-0069): a catalogue example ("a runnable app
// with sample data, verified in the sandbox") and a to-do app in a stack TurbineH does not build.
describe("general requirements are not functions (ADR-0069)", () => {
  it.each([
    [
      "Given the user opens the sandbox, when the app starts, then the application must be in a runnable state.",
      "runnable",
    ],
    ["The application runs successfully within the TurbineH sandbox environment.", "verified"],
    [
      "Given the app is running, when the user opens the reports area, then they see pre-populated sample data.",
      "sample-data",
    ],
    [
      "Given the app is running, when the user accesses the audit logs, then they must see sample audit entries.",
      "sample-data",
    ],
    ["The code follows good web development practices.", "good-practices"],
    [
      "Given the application is loaded, when the user views it, then the UI shows a neon aesthetic using CSS.",
      "look-and-feel",
    ],
    [
      "Given the user interacts with the page, then visual transitions and effects are applied.",
      "look-and-feel",
    ],
    [
      "Given the app is running, when the user performs any CRUD operation, then the data persists after a page refresh.",
      "persistence",
    ],
  ])("%s → %s", (criterion, kind) => {
    expect(generalKind(criterion)).toBe(kind);
  });

  it.each([
    "Given a note exists, when the user edits it, then the change is saved in the database.",
    "Given a task is active, when the user archives it, then it moves to the archived list.",
    "Given a customer books a sample session, then the booking is created.",
    "The owner exports the filtered records as a CSV file.",
    "Given a request, the status transitions from pending to approved when staff approve it.",
    "Given a ticket, when the assistant classifies it, then the label is stored.",
    "The user toggles dark mode and the theme is kept.",
  ])("a function stays functional: %s", (criterion) => {
    expect(generalKind(criterion)).toBeNull();
  });

  it("separates them with how each is handled, and records the stack note; idempotent", () => {
    const spec = {
      recipe: "projects",
      app_name: "Neon Tasks",
      summary: "To-do lists grouped in projects.",
      entities: [],
      roles: ["owner"],
      pages: [{ path: "/", purpose: "Home", auth_required: false }],
      capabilities: ["security.headers"],
      acceptance_criteria: [
        "Given a project, when the user adds a task, then the task is saved in the SQLite database.",
        "Given the application is loaded, then the UI displays a neon aesthetic using Bootstrap.",
        "Given the app is running, when the user performs any CRUD operation, then the data persists after a reload.",
      ],
    } as unknown as BuildSpec;
    const prompt = "Una app de tareas en HTML5, CSS y Bootstrap con los datos en SQLite";
    const out = separateGeneral(spec, prompt);
    expect(out.spec.acceptance_criteria).toEqual([
      "Given a project, when the user adds a task, then the task is saved in the SQLite database.",
    ]);
    expect(out.general.map((g) => g.kind)).toEqual(["look-and-feel", "persistence", "stack"]);
    expect(out.general.find((g) => g.kind === "look-and-feel")?.how).toMatch(/brand/);
    expect(out.general.find((g) => g.kind === "stack")?.how).toMatch(
      /TypeScript \+ Next\.js \+ PostgreSQL \+ Drizzle.*PostgreSQL, a database, instead of SQLite/,
    );
    const again = separateGeneral(out.spec, prompt);
    expect(again.spec.acceptance_criteria).toEqual(out.spec.acceptance_criteria);
    expect(again.general).toHaveLength(3);
  });

  it("names the stack asked for, never refuses it", () => {
    expect(stackNote("A shop in PHP with MySQL")?.asked).toEqual(["MySQL", "PHP"]);
    expect(stackNote("Guarda los datos en un archivo JSON")?.asked).toEqual(["a JSON file"]);
    expect(stackNote("An express checkout for my shop")).toBeNull();
    expect(stackNote("A booking site for a physiotherapy clinic")).toBeNull();
    expect(stackNote("A JavaScript widget")).toBeNull();
  });

  it("sample data is never claimed: the plan says it is not included", () => {
    const out = separateGeneral(
      {
        acceptance_criteria: ["Given the app starts, then it shows sample data for every section."],
      } as unknown as BuildSpec,
      "",
    );
    expect(out.general[0]?.how).toMatch(/^Not included/);
  });
});

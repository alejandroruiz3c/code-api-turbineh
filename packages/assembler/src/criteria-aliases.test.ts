import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDomains, type BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { readAcceptanceJson } from "./agent-guide.js";
import { readAliasDeclaration, valuesAt } from "./aliases.js";
import { assemble, coverageRules } from "./assemble.js";
import { acceptanceStatus } from "./acceptance.js";

/** Criteria aliases (ADR-0046) on the Frontiers ai-agents + domain.bookings spec (Flex Physio). */
const repo = join(import.meta.dirname, "../../..");
const recipesDir = join(repo, "catalog/recipes");
const componentsDir = join(repo, "catalog/components");

const native = (id: string, capability: string) => ({
  capability,
  why: { pBest: 1, covers: 1, risk: 0 },
  component: {
    id,
    status: "approved" as const,
    provides: [capability],
    pkg: { name: `turbineh/${id}`, version: "0.1.0" },
    license: { declared: "Apache-2.0", detected: "Apache-2.0" },
    peer: {},
    conflicts: [],
    requires: [],
  },
});

/** The Frontiers agent prompt and the 14 criteria the compiler extracted from it (learning round 2026-10-13). */
const PROMPT =
  'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring).';
const CRITERIA = [
  "Given a patient asks for availability, when the assistant queries the clinic data, then it must only return slots within Mon-Fri 09:00-19:00 Europe/Madrid.",
  "Given a patient requests a booking, when the assistant identifies a slot, then it must confirm the date, time, and therapist with the patient before calling the booking tool.",
  "Given a patient provides a chosen therapist, when the assistant checks availability, then it must filter results specifically for that physiotherapist.",
  "Given a patient requests to reschedule, when the assistant processes the request, then it must use the tool to move the existing booking to a new slot.",
  "Given a patient requests to cancel, when the appointment is less than 24 hours away, then the assistant must refuse the cancellation.",
  "Given a patient asks about pricing, when the assistant responds, then it must state 60 € for the first visit and 50 € for follow-ups.",
  "Given a patient asks for the clinic location, when the assistant responds, then it must provide the correct clinic address.",
  "Given a patient asks what to bring, when the assistant responds, then it must provide the relevant clinic instructions.",
  "Given a successful booking, when the process completes, then the assistant must trigger a confirmation email to the patient.",
  "Given a staff member accesses the dashboard, when they sign in, then they must be able to view and manage all existing bookings.",
  "Given a user sends a request, when the input exceeds the defined character limit, then the assistant must reject the input to prevent abuse.",
  "Given a user sends multiple rapid requests, when the rate limit is exceeded, then the assistant must throttle the responses.",
  "Given a malicious prompt injection attempt, when the input is processed, then the assistant must refuse to deviate from its booking assistant persona.",
  "Given the test suite runs, when the LLM is called, then it must communicate with a local mock endpoint instead of the real OpenAI API.",
];
/** Proven with the aliases: reschedule, cancel, pricing (asserted from params), confirmation email, input limit. */
const PROVEN = [3, 4, 5, 8, 10];

const spec: BuildSpec = {
  recipe: "ai-agents",
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Flex Physio Assistant",
  slug: "flex-physio",
  summary: "Booking assistant for a physiotherapy clinic.",
  roles: ["staff"],
  entities: [
    { name: "Physiotherapist", fields: [{ name: "name", type: "string", required: true }] },
    { name: "Booking", fields: [{ name: "startsAt", type: "datetime", required: true }] },
    { name: "Patient", fields: [{ name: "email", type: "email", required: true }] },
  ],
  pages: [{ path: "/", purpose: "Chat with the assistant", auth_required: false }],
  capabilities: ["ai.orchestrator"],
  acceptance_criteria: CRITERIA,
};

const selected = [
  native("ai.orchestrator.turbineh", "ai.orchestrator"),
  native("security.ai-safety.turbineh", "security.ai-safety"),
  native("domain.bookings.turbineh", "domain.bookings"),
];

function build(): string {
  const out = mkdtempSync(join(tmpdir(), "aliases-app-"));
  assemble({
    buildId: "b-aliases",
    recipesDir,
    recipe: "ai-agents",
    outDir: out,
    spec,
    selected,
    gaps: [],
    domains: detectDomains(PROMPT, "ai-agents", spec.app_name),
  });
  return out;
}

describe("criteria aliases (ADR-0046)", () => {
  it("resolves the bookings component's words from this app's params", () => {
    const out = build();
    const aliases = JSON.parse(readFileSync(join(out, ".turbineh/aliases.json"), "utf8")) as {
      aliases: { term: string; means: string[] }[];
    }[];
    const means = Object.fromEntries((aliases[0]?.aliases ?? []).map((a) => [a.term, a.means]));
    expect(means.customer).toEqual(["patient"]);
    expect(means["staff member"]).toEqual(["physiotherapist"]);
    expect(means.business).toEqual(["flex physio", "clinic"]);
    expect(means.service).toEqual(["first visit", "follow-up"]);
  });

  it("proves the Frontiers spec's criteria a shipped test exercises in this app's words, and no others", () => {
    const out = build();
    const statuses = readAcceptanceJson(out);
    expect(
      statuses.flatMap((s, i) => (s.status === "open" ? [] : [i])),
      JSON.stringify(statuses.map((s) => [s.status, s.criterion.slice(0, 50)])),
    ).toEqual(PROVEN);
  });

  it("drops the pricing proof when the test stops asserting the services from params", () => {
    const out = build();
    const file = join(out, "tests/e2e/booking-assistant.spec.ts");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        /expect\(reply, "states each service and its price from params\.services"\)/,
        "expect(reply)",
      ),
    );
    const statuses = acceptanceStatus(
      [CRITERIA[5] as string],
      coverageRules({ recipesDir, recipe: "ai-agents", selected }, out),
    );
    expect(statuses[0]?.status).toBe("open");
  });

  it("every alias declaration names params its component ships", () => {
    for (const id of ["domain.bookings.turbineh", "domain.workflow.turbineh"]) {
      const decl = readAliasDeclaration(join(componentsDir, id));
      expect(decl, id).not.toBeNull();
      const params = JSON.parse(
        readFileSync(join(componentsDir, id, "files", decl?.file ?? ""), "utf8"),
      ) as unknown;
      for (const a of decl?.aliases ?? [])
        for (const p of Array.isArray(a.from) ? a.from : [a.from])
          // Optional words (businessKind, stateNoun) may be absent from the defaults; the path must still be valid.
          expect(
            valuesAt(params, p).length > 0 || /businessKind|stateNoun/.test(p),
            `${id}: ${p}`,
          ).toBe(true);
    }
  });
});

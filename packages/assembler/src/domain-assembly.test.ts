import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDomains, type BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { acceptanceStatus, assemble, coverageRules, finalizeAcceptance } from "./index.js";

const repo = join(import.meta.dirname, "../../..");
const recipesDir = join(repo, "catalog/recipes");

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

const PROMPT =
  'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
  "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients cancel not later than 24 hours before, and ask " +
  "common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring).";

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
  acceptance_criteria: [
    "Patients can book a session through the chat and receive a confirmation email",
    "Cancellations later than 24 hours before the session are refused",
    "The clinic exports invoices to its accounting software",
  ],
};

describe("domain components in an assembled app (ADR-0033)", () => {
  it("installs the booking domain with the request's parameters, its toolkit and its acceptance proofs", () => {
    const domains = detectDomains(PROMPT, "ai-agents", spec.app_name);
    const selected = [
      native("ai.orchestrator.turbineh", "ai.orchestrator"),
      native("security.ai-safety.turbineh", "security.ai-safety"),
      native("domain.bookings.turbineh", "domain.bookings"),
    ];
    const out = mkdtempSync(join(tmpdir(), "booking-app-"));
    assemble({
      buildId: "b1",
      recipesDir,
      recipe: "ai-agents",
      outDir: out,
      spec,
      selected,
      gaps: [],
      domains,
    });

    const params = JSON.parse(readFileSync(join(out, "src/bookings/params.json"), "utf8"));
    expect(params).toMatchObject({
      business: "Flex Physio",
      timeZone: "Europe/Madrid",
      slotMinutes: 45,
    });
    // AI part of the component (files-ai) and the generated toolkit registry.
    expect(existsSync(join(out, "src/bookings/toolkit.ts"))).toBe(true);
    expect(existsSync(join(out, "tests/mock-llm/scripts/bookings.ts"))).toBe(true);
    expect(readFileSync(join(out, "src/lib/ai/toolkits.ts"), "utf8")).toContain(
      'import { toolkit as bookingsToolkit } from "@/bookings/toolkit";',
    );
    // The domain implements bookings, physiotherapists and patients: no generic CRUD duplicates them.
    expect(existsSync(join(out, "src/entities/bookings"))).toBe(false);
    expect(existsSync(join(out, "src/entities/physiotherapists"))).toBe(false);
    expect(readFileSync(join(out, "src/entities/index.ts"), "utf8")).toContain(
      "/dashboard/appointments",
    );

    // Component guides for coding agents.
    expect(
      readFileSync(join(out, "docs/components/domain.bookings.turbineh.md"), "utf8"),
    ).toContain("## Extension points");
    expect(
      existsSync(join(out, "docs/components/ai.orchestrator.turbineh.tests-mock-llm.md")),
    ).toBe(true);

    const acceptance = JSON.parse(readFileSync(join(out, ".turbineh/acceptance.json"), "utf8"));
    // Precision first (ADR-0043): the assistant test never acts as a "patient", so the booking criterion stays open.
    expect(acceptance.map((a: { status: string }) => a.status)).toEqual([
      "open",
      "covered",
      "open",
    ]);
    expect(readFileSync(join(out, "ACCEPTANCE.md"), "utf8")).toContain("2 of 3 criteria are open");
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain(
      "[ACCEPTANCE.md](ACCEPTANCE.md)",
    );
    expect(finalizeAcceptance(out, true).map((a) => a.status)).toEqual(["open", "met", "open"]);
  });

  it("maps criteria to tests with code only", () => {
    const rules = coverageRules({
      recipesDir,
      recipe: "ai-agents",
      selected: [native("domain.bookings.turbineh", "domain.bookings")],
    });
    const [s] = acceptanceStatus(["Staff sign in to see and manage the bookings"], rules);
    expect(s?.tests.join(" ")).toContain("only staff on ADMIN_EMAILS");
  });
});

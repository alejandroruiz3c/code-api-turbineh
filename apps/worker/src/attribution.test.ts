import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assemble, readOwners } from "@turbineh/assembler";
import { detectDomains, type BuildSpec } from "@turbineh/compiler";
import { attributeFailures, culpritsOf, type SwapPart } from "@turbineh/integrator";
import { gateFailures, parseSteps, type VerifyResult } from "@turbineh/verifier";
import { beforeAll, describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "../../..");

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
  app_name: "Flex Physio AI Assistant",
  slug: "flex-physio-ai-assistant",
  summary: "Booking assistant for a physiotherapy clinic.",
  roles: ["staff"],
  entities: [{ name: "Invoice", fields: [{ name: "number", type: "string", required: true }] }],
  pages: [{ path: "/", purpose: "Chat with the assistant", auth_required: false }],
  capabilities: ["ai.orchestrator"],
  acceptance_criteria: [
    "Patients can book a session through the chat",
    "Cancellations later than 24 hours before the session are refused",
    "Staff sign in to see and manage the bookings",
  ],
};

// The 12 libraries 66af3182 integrated after assembly and then removed for a failure in domain.bookings' E2E.
const LIBS: [string, string, string][] = [
  ["ui.calendar", "ui.calendar.react-day-picker", "react-day-picker"],
  ["data.dates", "data.dates.date-fns", "date-fns"],
  ["data.ids", "data.ids.cuid2", "@paralleldrive/cuid2"],
  ["data.money", "data.money.decimal-js", "decimal.js"],
  ["data.serialization", "data.serialization.superjson", "superjson"],
  ["ui.notifications", "ui.notifications.sonner", "sonner"],
  ["ops.http-client", "ops.http-client.ky", "ky"],
  ["email.plain-text", "email.plain-text.html-to-text", "html-to-text"],
  ["ui.alert-dialog", "ui.alert-dialog.radix", "@radix-ui/react-alert-dialog"],
  ["ai.token-count", "ai.token-count.gpt-tokenizer", "gpt-tokenizer"],
  ["ai.prompt-templates", "ai.prompt-templates.mustache", "mustache"],
];

let dir = "";
let parts: SwapPart[] = [];

function write(rel: string, content: string) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

const verifyResult = (tail: string): VerifyResult => {
  const steps = parseSteps(tail);
  return {
    ok: false,
    steps,
    findings: { secrets: 0, advisories: [], licenses: [], static: [] },
    scannedAt: "2026-10-13T04:59:19.449Z",
  };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "attribution-"));
  assemble({
    buildId: "66af3182-b4e3-4b9f-abb7-f94a54ae47a8",
    recipesDir: join(repo, "catalog/recipes"),
    recipe: "ai-agents",
    outDir: dir,
    spec,
    selected: [
      native("ai.orchestrator.turbineh", "ai.orchestrator"),
      native("security.ai-safety.turbineh", "security.ai-safety"),
      native("domain.bookings.turbineh", "domain.bookings"),
    ],
    gaps: [],
    domains: detectDomains(PROMPT, "ai-agents", spec.app_name),
  });
  parts = [];
  for (const [capability, id, pkg] of LIBS) {
    const test = `tests/unit/components/${id}.test.ts`;
    write(test, `import { describe, it } from "vitest";\nimport * as lib from "${pkg}";\n`);
    parts.push({ capability, kind: "integration", files: [test], package: pkg });
    if (capability === "data.dates") {
      const glue = "src/integrations/data-dates.ts";
      write(glue, `import { format } from "date-fns";\nexport const fmt = format;\n`);
      parts.push({ capability, kind: "glue", files: [glue] });
    }
  }
  // A Backup Coder fill (T1) with its own unit test.
  write("src/backup/ops-idempotency.ts", "export const key = () => 'k';\n");
  write(
    "tests/unit/backup/ops-idempotency.test.ts",
    'import { key } from "@/backup/ops-idempotency";\n',
  );
  parts.push({
    capability: "ops.idempotency",
    kind: "backup",
    files: ["src/backup/ops-idempotency.ts", "tests/unit/backup/ops-idempotency.test.ts"],
  });
});

describe("failure attribution (ADR-0037 §D2)", () => {
  it("the assembled package records who owns each file", () => {
    const owners = readOwners(dir);
    expect(owners["tests/e2e/booking-assistant.spec.ts"]).toBe(
      "component:domain.bookings.turbineh",
    );
    expect(owners["src/bookings/service.ts"]).toBe("component:domain.bookings.turbineh");
    expect(owners["src/bookings/params.json"]).toBe("component:domain.bookings.turbineh");
    expect(owners["src/lib/ai/agent.ts"]).toBe("component:ai.orchestrator.turbineh");
    expect(owners["package.json"]).toMatch(/^recipe:/);
    expect(Object.values(owners)).toContain("entity:Invoice");
  });

  it("66af3182: an E2E failure in domain.bookings removes none of the 12 unrelated components", () => {
    const v = verifyResult(`STEP unit 0 7216
STEP build 0 38485
STEP e2e 1 43357
FAILED_LINE e2e   1) [chromium] › tests/e2e/booking-assistant.spec.ts:174:7 › booking assistant › staff pages ─
FAILED_LINE e2e     Error: expect(page).toHaveURL(expected) failed`);
    const failures = attributeFailures(dir, gateFailures(v), parts, "");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      step: "e2e",
      file: "tests/e2e/booking-assistant.spec.ts",
      line: 174,
      owner: "component:domain.bookings.turbineh",
      implicated: [],
    });
    expect(culpritsOf(parts, failures)).toEqual([]);
  });

  it("a failing contract test implicates only its own library (and its glue)", () => {
    const v = verifyResult(`STEP unit 1 5000
FAILED_LINE unit  FAIL  tests/unit/components/data.dates.date-fns.test.ts > date-fns > formats
FAILED_LINE unit AssertionError: expected 'x' to be 'y'`);
    const failures = attributeFailures(dir, gateFailures(v), parts, "");
    expect(failures[0]?.owner).toBe("integration:data.dates");
    expect(culpritsOf(parts, failures).map((p) => `${p.kind}:${p.capability}`)).toEqual([
      "integration:data.dates",
      "glue:data.dates",
    ]);
  });

  it("a test importing a glue helper implicates the glue only (the library stays)", () => {
    write(
      "tests/unit/format.test.ts",
      'import { fmt } from "../../src/integrations/data-dates";\nimport { x } from "@/lib/utils";\n',
    );
    const v = verifyResult(`STEP unit 1 5000
FAILED_LINE unit  FAIL  tests/unit/format.test.ts > formats a date`);
    const failures = attributeFailures(dir, gateFailures(v), parts, "");
    // Imports date-fns through the glue: the library is implicated too, only because the glue imports it.
    expect(failures[0]?.imports.map((i) => i.file)).toContain("src/integrations/data-dates.ts");
    expect(failures[0]?.implicated).toContain("data.dates");
    expect(failures[0]?.implicated).not.toContain("ui.calendar");
    expect(culpritsOf(parts, failures).every((p) => p.capability === "data.dates")).toBe(true);
  });

  it("a Backup Coder test failure implicates that fill only", () => {
    const v = verifyResult(`STEP unit 1 5000
FAILED_LINE unit  FAIL  tests/unit/backup/ops-idempotency.test.ts > key > is stable`);
    const failures = attributeFailures(dir, gateFailures(v), parts, "");
    expect(culpritsOf(parts, failures).map((p) => p.capability)).toEqual(["ops.idempotency"]);
  });

  it("an install failure implicates the libraries it names, else every integrated library", () => {
    const named = attributeFailures(
      dir,
      [{ step: "install", test: null, file: null, line: null, message: "install failed" }],
      parts,
      "ERR_PNPM_NO_MATCHING_VERSION No matching version found for superjson@9.9.9",
    );
    expect(named[0]?.implicated).toEqual(["data.serialization"]);
    const unnamed = attributeFailures(
      dir,
      [{ step: "install", test: null, file: null, line: null, message: "install failed" }],
      parts,
      "network error",
    );
    expect(unnamed[0]?.implicated).toHaveLength(LIBS.length);
    expect(unnamed[0]?.implicated).not.toContain("ops.idempotency");
  });

  it("a failure without any file removes nothing", () => {
    const failures = attributeFailures(
      dir,
      [{ step: "build", test: null, file: null, line: null, message: "build failed" }],
      parts,
    );
    expect(culpritsOf(parts, failures)).toEqual([]);
  });
});

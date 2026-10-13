import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { detectDomains } from "@turbineh/compiler";
import { proofVerdict, type ProofAlias, type ProofCandidate } from "@turbineh/shared";
import { LABELLED_PAIRS as PROOF_PAIRS } from "@turbineh/shared/criterion-proof-pairs";
import { describe, expect, it } from "vitest";
import { testBlocks } from "./acceptance.js";
import { actorAliases, aliasesFor, readAliasDeclaration, resolveAliases } from "./aliases.js";

/**
 * Recall without relaxing the matcher (ADR-0045): the same 109 labelled pairs (criterion, the test a rule cited, human
 * label), re-scored with each test as the catalog ships it today — renamed in criterion language, with assertion
 * messages that say what each check proves. Precision must stay 1.00.
 */
const catalog = join(__dirname, "../../../catalog");

/** Learning-round test titles → the same test's title today (ADR-0045 renames; the injection test was split). */
const RENAMED: Record<string, string> = {
  "a request is submitted, a file is attached and downloaded, and the status is updated":
    "the owner submits a document request, uploads a PDF file to it and downloads it as an attachment, then updates the request's status",
  "a user who sends a request whose input exceeds the defined character limit is rejected with a 400 error, to prevent abuse":
    "a user who sends the assistant a request whose input exceeds the defined character limit is rejected with a 400 error, to prevent abuse",
  "a visitor joins the waitlist":
    "a visitor on the landing page submits their name and email and joins the waitlist",
  "an allowlisted email gets staff access only after the address is verified":
    "a new user signs up: their workspace is created with them as owner, and an allowlisted email gets staff access only after the address is verified",
  "an overlapping booking is rejected":
    "a slot that is already taken cannot be booked again: the overlapping (double) booking is rejected",
  "answers common questions from the business's data":
    "a customer asks about prices: the assistant responds stating each service with its price, from the business's data",
  "books only a real free time, after the person confirms, and logs the confirmation email":
    "a customer books through the assistant only a real free slot, after confirming the date, time and staff member; it triggers the confirmation email (logged) and staff see the booking",
  "browses home, services, about and contact":
    "a visitor browses the home page, the services page, about and contact",
  "creates a project and a task assigned to me":
    "the owner creates a project and a task assigned to them with a priority and a due date; a task past its due date is flagged overdue",
  "dashboard requires sign-in":
    "a user who is not authenticated and attempts to access the dashboard is redirected to the sign-in page",
  "filters by category and exports CSV":
    "the dashboard filters by category and exports the filtered data as a CSV file",
  "imports a CSV and shows exact KPIs and charts":
    "the owner imports a CSV, the invalid row is rejected, and the dashboard shows exact KPIs and charts",
  "moves the task across the board":
    "the owner moves a task on the Kanban board from To do to In progress and the new status is persisted",
  "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged":
    "a shopper pays with Stripe Checkout at server-computed amounts; the signed webhook marks the order paid, decrements each product's stock and logs the confirmation email",
  "refuses to cancel inside the notice period":
    "a customer requests to cancel a booking that starts less than the notice hours away (inside the notice period): the assistant refuses the cancellation",
  "rejects prompt injection and oversized messages":
    "a user who sends the assistant a request whose input exceeds the defined character limit is rejected with a 400 error, to prevent abuse",
  "reschedules with reference + email after confirmation":
    "a customer requests to reschedule: the assistant uses the booking tool to move an existing booking to a new free slot, with its reference and email, after the customer confirms",
  "sends a contact message": "a visitor submits the contact form and gets a confirmation",
  "shoppers search the catalogue by product name: only matching products are listed":
    "shoppers search the catalogue by product name: the list filters to only the matching products",
  "shows the task in My tasks and lets me comment on it":
    "a task assigned to the owner shows in My tasks, and the owner adds a comment that is visible on that task",
  "the admin edits the website headline":
    "the owner (admin) edits the website headline and the home page shows it",
  "the admin reads the message": "the owner (admin) reads the contact message in the dashboard",
  "the admin sees every order with its payment status in the orders section":
    "the owner accesses the admin area and sees the list of all orders with their payment status",
  "the admin sees waitlist signups":
    "the owner (admin) sees the list of waitlist signups in the dashboard",
  "the admin updates a product's price and the public catalogue shows it at once":
    "the owner accesses the admin area, creates a product, reads it in the list, edits its details (price) and deletes (hides) it; the public catalogue follows at once",
  "the admin updates a product's stock and the public catalogue reflects it at once":
    "the owner (admin) updates a product's stock level and the public catalogue reflects it at once",
  "the owner (admin) creates a product, then edits its price, and the public catalogue shows it at once":
    "the owner accesses the admin area, creates a product, reads it in the list, edits its details (price) and deletes (hides) it; the public catalogue follows at once",
  "the owner (admin) sees the list of all orders with their payment status in the orders section":
    "the owner accesses the admin area and sees the list of all orders with their payment status",
  "the owner accesses the admin area, creates a product, then edits its price; the public catalogue shows it at once":
    "the owner accesses the admin area, creates a product, reads it in the list, edits its details (price) and deletes (hides) it; the public catalogue follows at once",
  "the owner books a slot and sees it in the calendar":
    "the owner books a slot for a customer (name and email): the booking is confirmed and the owner sees it in the calendar",
  "the owner opens every day from 08:00 to 20:00 (UTC)":
    "the owner sets the availability (opening hours): every day from 08:00 to 20:00 (UTC)",
};

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (n === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(spec|test)\.ts$/.test(n) ? [p] : [];
  });
}

/** Every catalog test by title, with its path inside the app (tests/…). */
const shipped = new Map<string, ProofCandidate & { file: string }>();
for (const f of walk(catalog).filter((p) => existsSync(p)))
  for (const b of testBlocks(readFileSync(f, "utf8")))
    shipped.set(b.title, { ...b, file: relative(catalog, f).replace(/^.*?\/(tests\/)/, "$1") });

/**
 * ADR-0047: the agent pairs come from the Flex Physio build; its bookings params give the component's aliases
 * (customer → patient, staff member → physiotherapist, the services). Resolved exactly as the assembler does.
 */
const FLEX_PHYSIO =
  'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring).';
function flexPhysioAliases() {
  const app = mkdtempSync(join(tmpdir(), "recall-aliases-"));
  const domain = detectDomains(FLEX_PHYSIO, "ai-agents", "Flex Physio").find(
    (d) => d.component === "domain.bookings.turbineh",
  );
  const decl = readAliasDeclaration(join(catalog, "components/domain.bookings.turbineh"));
  if (!domain || !decl) return [];
  mkdirSync(join(app, "src/bookings"), { recursive: true });
  writeFileSync(join(app, decl.file), JSON.stringify(domain.params));
  const r = resolveAliases("domain.bookings.turbineh", decl, app);
  return r ? [r] : [];
}
const agentAliases = flexPhysioAliases();
const shopActors = actorAliases([
  join(catalog, "recipes/storefront"),
  join(catalog, "recipes/saas-crud"),
]);

function score(current: boolean, aliases = false) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const p of PROOF_PAIRS) {
    const now = current ? shipped.get(RENAMED[p.test.title] ?? p.test.title) : undefined;
    let test: ProofCandidate = now ?? p.test;
    const found: ProofAlias[] | undefined =
      !aliases || !now
        ? undefined
        : p.id.startsWith("rule-agent-")
          ? aliasesFor(now.file, agentAliases)
          : // ADR-0048: the storefront's declared actors, on the storefront runs' recipe tests.
            p.id.startsWith("rule-shop-") && !now.file.includes("booking")
            ? shopActors
            : undefined;
    if (found) test = { ...test, aliases: found };
    const proven = proofVerdict(p.criterion, test).proven;
    if (proven && p.met) tp++;
    else if (proven) fp++;
    else if (p.met) fn++;
  }
  return { tp, fp, fn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) };
}

describe("criteria recall with the tests as shipped today", () => {
  it("every renamed test exists in the catalog under its new title", () => {
    for (const now of Object.values(RENAMED)) expect(shipped.has(now), now).toBe(true);
  });

  it("keeps precision at 1.00 and raises recall on the 109 labelled pairs", () => {
    const before = score(false);
    const now = score(true);
    const withAliases = score(true, true);
    console.log(JSON.stringify({ pairs: PROOF_PAIRS.length, before, now, withAliases }));
    // ADR-0047: aliases from the app's params never cost precision.
    expect(agentAliases.length).toBe(1);
    expect(withAliases.fp).toBe(0);
    expect(withAliases.recall).toBeGreaterThanOrEqual(now.recall);
    expect(PROOF_PAIRS.length).toBeGreaterThanOrEqual(109);
    expect(now.fp).toBe(0);
    expect(now.precision).toBe(1);
    expect(now.recall).toBeGreaterThan(before.recall);
    expect(now.recall).toBeGreaterThanOrEqual(0.85);
  });
});

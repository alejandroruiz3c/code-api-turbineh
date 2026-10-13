import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { proofVerdict, type ProofCandidate } from "@turbineh/shared";
import { LABELLED_PAIRS as PROOF_PAIRS } from "@turbineh/shared/criterion-proof-pairs";
import { describe, expect, it } from "vitest";
import { testBlocks } from "./acceptance.js";

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
    "the assistant answers common questions (prices, services and opening hours) from the business's data",
  "books only a real free time, after the person confirms, and logs the confirmation email":
    "the assistant books only a real free slot after the person confirms the date, time and staff member; the confirmation email is logged and staff see the booking",
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
    "the assistant refuses to cancel a booking inside the notice period (fewer hours before it starts than the cancellation notice)",
  "rejects prompt injection and oversized messages":
    "a user who sends the assistant a request whose input exceeds the defined character limit is rejected with a 400 error, to prevent abuse",
  "reschedules with reference + email after confirmation":
    "the assistant reschedules (moves) an existing booking to a new free slot, with its reference and email, after the person confirms",
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

const shipped = new Map<string, ProofCandidate>();
for (const f of walk(catalog).filter((p) => existsSync(p)))
  for (const b of testBlocks(readFileSync(f, "utf8"))) shipped.set(b.title, b);

function score(current: boolean) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const p of PROOF_PAIRS) {
    const test = current ? (shipped.get(RENAMED[p.test.title] ?? p.test.title) ?? p.test) : p.test;
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
    console.log(JSON.stringify({ pairs: PROOF_PAIRS.length, before, now }));
    expect(PROOF_PAIRS.length).toBeGreaterThanOrEqual(109);
    expect(now.fp).toBe(0);
    expect(now.precision).toBe(1);
    expect(now.recall).toBeGreaterThan(before.recall);
    expect(now.recall).toBeGreaterThanOrEqual(0.85);
  });
});

/**
 * Labelled criterion → test pairs for the proof matcher (ADR-0038 §4). `met` is the human label: does this test, by
 * its title and assertions, prove the criterion (subject, action, outcome, actor, negation)? The first six pairs are
 * the false "met" of production build f195341c (Fieldnote, saas-crud); they must come out "open".
 */
import type { ProofCandidate } from "./criterion-proof.js";

export interface ProofPair {
  id: string;
  criterion: string;
  test: ProofCandidate;
  met: boolean;
}

const create = (entity: string, cell = "Sample text"): ProofCandidate => ({
  title: `owner creates a ${entity} and sees it in the list`,
  assertions: [`await expect(page.getByRole("cell", { name: "${cell}" }).first()).toBeVisible();`],
});
const edit = (entity: string): ProofCandidate => ({
  title: `owner edits a ${entity} and sees the change`,
  assertions: [
    `await expect(page.getByRole("heading", { name: "Edit ${entity}" })).toBeVisible();`,
    `await expect(page.getByRole("cell", { name: "Sample text edited" }).first()).toBeVisible();`,
  ],
});
const exportCsv = (plural: string): ProofCandidate => ({
  title: `${plural} export as CSV with a header row`,
  assertions: [
    "expect(res.status()).toBe(200);",
    'expect(res.headers()["content-type"]).toContain("text/csv");',
    'expect((await res.text()).split("\\r\\n")[0]).toBe("title,body");',
  ],
});
const importCsv = (plural: string): ProofCandidate => ({
  title: `${plural} import from CSV`,
  assertions: ['await expect(page.getByRole("status")).toContainText("Imported 1 rows");'],
});

export const PROOF_PAIRS: ProofPair[] = [
  // ── Production false matches (build f195341c): all must be open ─────────────────────────────────────────────
  {
    id: "prod-viewer-cannot-edit",
    criterion: "Given a viewer, when they attempt to edit a note, the system denies the request.",
    test: edit("note"),
    met: false,
  },
  {
    id: "prod-invite-teammate",
    criterion:
      "Given an owner, when they invite a teammate via email, the teammate is assigned the specified role (owner, editor, or viewer).",
    test: create("workspace member"),
    met: false,
  },
  {
    id: "prod-audit-log",
    criterion:
      "Given a change to any note, when an owner views the audit log, the change is recorded and visible.",
    test: create("note"),
    met: false,
  },
  {
    id: "prod-search",
    criterion:
      "Given the notes list, when a user searches by text, the list updates to show only matching notes.",
    test: edit("note"),
    met: false,
  },
  {
    id: "prod-tag-filter",
    criterion:
      "Given the notes list, when a tag filter is applied, the list updates to show only notes containing that tag.",
    test: edit("note"),
    met: false,
  },
  {
    id: "prod-signup-owner",
    criterion:
      "Given a new user, when they sign up, a workspace is created and they are assigned the 'owner' role.",
    test: create("workspace member"),
    met: false,
  },
  {
    id: "prod-filtered-export",
    criterion:
      "Given a filtered list of notes, when the user clicks export, a CSV file containing only the filtered results is downloaded.",
    test: exportCsv("notes"),
    met: false,
  },
  // ── Generated entity tests: true proofs ─────────────────────────────────────────────────────────────────────
  { id: "g-create-note", criterion: "Owner can create a note.", test: create("note"), met: true },
  {
    id: "g-add-customer",
    criterion: "Users can add a customer.",
    test: create("customer"),
    met: true,
  },
  {
    id: "g-new-project",
    criterion: "An owner creates a new project and it appears in the list.",
    test: create("project"),
    met: true,
  },
  { id: "g-edit-task", criterion: "Owner can edit a task.", test: edit("task"), met: true },
  {
    id: "g-update-contact",
    criterion: "Users can update a contact.",
    test: edit("contact"),
    met: true,
  },
  {
    id: "g-export-invoices",
    criterion: "Invoices can be exported as CSV.",
    test: exportCsv("invoices"),
    met: true,
  },
  {
    id: "g-download-orders",
    criterion: "The owner can download orders as a CSV file.",
    test: exportCsv("orders"),
    met: true,
  },
  {
    id: "g-import-products",
    criterion: "Products can be imported from a CSV file.",
    test: importCsv("products"),
    met: true,
  },
  {
    id: "g-upload-leads",
    criterion: "Users can upload leads from CSV.",
    test: importCsv("leads"),
    met: true,
  },
  // ── Generated entity tests: not proofs ──────────────────────────────────────────────────────────────────────
  {
    id: "n-delete-note",
    criterion: "Owner can delete a note.",
    test: edit("note"),
    met: false,
  },
  {
    id: "n-guest-cannot-create",
    criterion: "Guests cannot create projects.",
    test: create("project"),
    met: false,
  },
  {
    id: "n-editor-edits",
    criterion: "An editor can edit tasks of their workspace.",
    test: edit("task"),
    met: false,
  },
  {
    id: "n-required-fields",
    criterion: "A customer must have a name and a valid email before it is saved.",
    test: create("customer"),
    met: false,
  },
  {
    id: "n-edit-history",
    criterion: "Every edit of an invoice is kept in its history.",
    test: edit("invoice"),
    met: false,
  },
  {
    id: "n-notify-on-create",
    criterion: "When a ticket is created, the assignee receives an email notification.",
    test: create("ticket"),
    met: false,
  },
  {
    id: "n-export-date-range",
    criterion: "Orders can be exported as CSV for a chosen date range.",
    test: exportCsv("orders"),
    met: false,
  },
  {
    id: "n-import-duplicates",
    criterion: "Importing products from CSV skips duplicates by SKU.",
    test: importCsv("products"),
    met: false,
  },
  {
    id: "n-sort-by-date",
    criterion: "The notes list can be sorted by interview date.",
    test: create("note"),
    met: false,
  },
  // ── Hand-written tests (recipes and components) ─────────────────────────────────────────────────────────────
  {
    id: "h-viewer-denied",
    criterion: "A viewer cannot edit a note.",
    test: {
      title: "a viewer reads notes but cannot edit them",
      assertions: ['await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);'],
    },
    met: true,
  },
  {
    id: "h-anonymous-redirect",
    criterion: "Anonymous visitors are redirected to sign in when they open the dashboard.",
    test: {
      title: "anonymous visitors are sent to sign-in from the dashboard",
      assertions: ["await expect(page).toHaveURL(/sign-in/);"],
    },
    met: true,
  },
  {
    id: "h-cancel-24h",
    criterion: "A patient cannot cancel a booking less than 24 hours before it starts.",
    test: {
      title: "a patient cannot cancel a booking less than 24 hours before it starts",
      assertions: ['await expect(page.getByRole("alert")).toContainText("24 hours");'],
    },
    met: true,
  },
  {
    id: "h-search-notes",
    criterion: "Searching the notes list by text shows only matching notes.",
    test: {
      title: "search shows only the notes matching the text",
      assertions: ['await expect(page.getByRole("row")).toHaveCount(2);'],
    },
    met: true,
  },
  {
    id: "h-audit-log",
    criterion: "Every change to a note is recorded in the audit log.",
    test: {
      title: "editing a note records the change in the audit log",
      assertions: ['await expect(page.getByRole("cell", { name: "note.updated" })).toBeVisible();'],
    },
    met: true,
  },
  {
    id: "h-staff-signup-refused",
    criterion: "Sign-up is refused for emails that are not on the staff list.",
    test: {
      title: "sign-up refuses emails that are not on the staff list",
      assertions: ['await expect(page.getByRole("alert")).toBeVisible();'],
    },
    met: true,
  },
  {
    id: "h-owner-vs-editor-audit",
    criterion: "Only owners can open the audit log.",
    test: {
      title: "owner opens the audit log",
      assertions: ['await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();'],
    },
    met: false,
  },
  {
    id: "h-colours",
    criterion: "The app uses the requested colours.",
    test: {
      title:
        "the app shows the requested colours: page background, accent colour and call-to-action buttons",
      assertions: ["expect(bg).toBe(NAVY);"],
    },
    met: true,
  },
  {
    id: "h-booking-email",
    criterion: "A confirmation email is sent after a booking.",
    test: {
      title: "a patient books a session and sees the confirmation",
      assertions: ['await expect(page.getByText("Booked")).toBeVisible();'],
    },
    met: false,
  },
  // ── Long Given/When/Then criteria of the Frontiers shop build (2026-10-12), hand-written tests ──────────────
  {
    id: "s-stock-decrement",
    criterion:
      "Given an order is marked as 'Paid' via webhook, then the stock level for each purchased product must be decremented by the quantity ordered.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'expect(order.status).toBe("paid");',
        "expect(product.stock).toBe(before - quantity);",
      ],
    },
    met: true,
  },
  {
    id: "s-search-name",
    criterion:
      "Given a user is browsing the catalogue, when they enter a product name in the search bar, then the displayed list must only contain products matching that name.",
    test: {
      title: "shoppers search the catalogue by product name: only matching products are listed",
      assertions: ['await expect(page.getByRole("listitem")).toHaveCount(1);'],
    },
    met: true,
  },
  {
    id: "s-admin-price",
    criterion:
      "Given an authenticated admin user is in the admin area, when they update a product's price, then the change must be reflected in the public catalogue immediately.",
    test: {
      title: "the admin updates a product's price and the public catalogue shows it at once",
      assertions: ['await expect(page.getByText("12.50")).toBeVisible();'],
    },
    met: true,
  },
  {
    id: "s-reviews",
    criterion: "Shoppers can leave reviews with star ratings.",
    test: {
      title: "a shopper adds a product to the cart at its price with quantity one",
      assertions: ['await expect(page.getByText("Subtotal")).toBeVisible();'],
    },
    met: false,
  },
];

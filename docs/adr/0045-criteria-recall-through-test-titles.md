# ADR-0045 · Criteria recall through tests that say what they prove

- Status: accepted (number may need renumbering at merge if another branch takes 0045)
- Date: 2026-10-13
- Context: ADR-0043 sent hand-written acceptance rules through `proofVerdict` (precision 1.00 on 109 labelled pairs).
  Recall fell to 0.62: tests that do prove a criterion were titled in test jargon ("pays with Stripe Checkout: …,
  stock decremented") and never named the subject, actor or outcome the criterion uses. A criterion shown as "open"
  when it is proven makes a coding agent redo finished work. ADR-0044 added generated tests with the same problem.

## Decision

Raise recall by changing the **tests**, never by relaxing the matcher.

1. **Titles in criterion language.** Every recipe template and domain component test that proves a common criterion
   states its subject, actor and outcome, and only what it asserts: "shoppers search the catalogue by product name: the
   list filters to only the matching products", "the owner accesses the admin area, creates a product, reads it in the
   list, edits its details (price) and deletes (hides) it…", "a slot that is already taken cannot be booked again: the
   overlapping (double) booking is rejected". `acceptance.yaml` rules follow the new titles.
2. **Assertion messages are part of the proof.** `testBlocks` now reads whole multi-line `expect(…)` statements, so
   a message such as `expect(stock, "the product stock is decremented by the quantity ordered (5 - 2)")` documents and
   proves the outcome it checks.
3. **Missing assertions added where a common criterion was untested**: product detail page, product delete (hide),
   order-confirmation email content (the test outbox file now keeps the text; the console log still never does), Kanban
   status persisted after a reload, a new user's workspace and owner role at sign-up, and the booking assistant's
   input-limit check split from the injection check.
4. **Generated tests (ADR-0044) too**: search ("the list updates to show only the matching notes, and the CSV export
   holds only those filtered results", with list assertions), tag filter (saved fields, filter applied), sort order,
   the audit trail of an edit when `domain.audit-log` is installed, the request's name for the owner role as the
   actor ("manager (owner) creates…"), CSV download wording, and permission tests that name the records they guard,
   say the request is refused, and list full CRUD per role.
5. **Matcher fixes that only tighten or normalise**: "sign(s|ed) up/in/out" normalise like "sign up"; "-ss" words keep
   their stem ("access", "process"); "detail" is content again; a criterion with fewer than two checkable words is
   never proven.

## Measurements

- 109 labelled pairs (`criteria-recall.test.ts`), each test as the catalog ships it today: precision **1.00**, recall
  0.62 → **0.92**. With the learning-round titles (frozen fixtures): precision 1.00, recall 0.62.
- `verify:spec` (full gate, all green): Fieldnote 0/11 → **9/11** met, Kilnwise 0/6 → **1/6**, Pixelyard 1/7 →
  **2/7**.
- The 14 learning-round packages' 139 criteria against the catalog's hand-written rules: 16 → 37 proven.
- Frontiers specs: storefront 7/7 (0 open); ai-agents + domain.bookings 1/14 (see below).

## Not done (honest limits)

- Criteria that use the request's own nouns for a generic component's actor or data ("a **patient** asks…", "the
  **clinic** address", "60 € for the first visit", "a **piece** … **stage**") stay open: a component test cannot claim
  them. Next step: the assembler could add the request's names (params `customer.singular`, workflow entity and states)
  to the proof of component tests, as a declared alias, not a matcher change.
- Features no template ships (pagination controls, careers page, drag and drop, rate-limit throttling) stay open.

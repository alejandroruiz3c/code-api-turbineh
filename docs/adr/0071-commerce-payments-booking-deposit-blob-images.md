# ADR-0071 · Commerce and payments from real demand: card payment when booking, storefront criteria, Blob images

- Status: accepted (number reserved for this change; parallel work packages hold the numbers around it)
- Date: 2026-10-21
- Context: production requests since 2026-10-13, replayed offline against the catalogue (owner rule, ADR-0052: only
  what a verified test proves is covered). Three gaps in commerce and payments:
  1. **Shops built at low functional coverage.** A simple shop with sizes, a cart and card payments (one of the
     web's own example prompts) and a full shop (variants, discount rules, currencies, shipping, taxes) were built
     on the storefront recipe, but most of their compiled criteria did not map to the recipe's canonical criteria
     (ADR-0063): "enters valid credit card details … a confirmation is shown", "a size that is out of stock … the
     button is disabled", "a qualifying cart", "the code is no longer valid", "shipping methods for that country are
     shown", "Stripe Tax is enabled … a shipping address"… Two of those functions had no canonical criterion at all
     (paying by card and seeing the paid order; refusing a sold-out option), the rest were proven by existing tests
     whose declared vocabulary missed the request's words. A clothing shop was even offered "covered part only"
     because "the item is added to the Stripe Checkout session with the correct price" was judged outside.
  2. **Product images removed before delivery.** A full shop selected `storage.objects` for "product details and
     associated images" → `storage.objects.vercel-blob`, an external library integrated with a model-written glue
     module. The glue (`any` types) failed lint and typecheck through three correction rounds, the failing check was
     attributed to the component, it was removed, and the approved plan's promise was broken ("Delivered, not
     verified"). The storefront already stores uploaded images (PostgreSQL), so the selection added nothing but risk.
  3. **Card payment when booking not covered.** A salon's booking site that charges a card when the customer books
     was refused: the bookings domain "does not take payments" and no component did.

## Decision

### 1 · `payments.booking-deposit.turbineh` (native component, chained to `domain.bookings.turbineh`)

- A deposit (fixed amount, capped at the price, or a percent of the service price rounded half up) or the full
  price, charged with **Stripe Checkout** through the documented REST API (payment mode, `payment_method_types[0] =
card`, `expires_at`, the booking id as `client_reference_id`, an idempotency key). Amounts only from
  `src/payments/booking-deposit.json` and the bookings params, never from the browser; no SDK, no card data.
- The public booking creates the appointment `pending_payment` with `hold_expires_at` (Checkout lifetime + 5
  minutes): its time cells are locked and availability treats it as taken. The customer is redirected to Stripe
  (host checked). **Only the signed webhook** (`/api/bookings/payments/webhook`, HMAC-SHA256, constant time,
  5-minute tolerance) confirms: `checkout.session.completed` + paid for exactly the recorded amount and currency →
  `confirmed` and the usual confirmation email with a cancel link, once (idempotent: the payment row moves
  `open → paid` conditionally). `checkout.session.expired` frees the time. A hold whose time ran out is also freed
  by the next booking (in the same transaction that creates it), so a lost event never blocks a time forever; a
  payment arriving for a time no longer held is **refunded** (`POST /v1/refunds`) instead of double-booking.
- Return page `/book/paid` shows the booking only when the reference and the Checkout session id Stripe appended
  both match. Without `STRIPE_SECRET_KEY`, a booking that needs a payment is refused with a clear message and its
  time freed — never confirmed unpaid.
- The bookings domain gains an **extension point** instead of a fork: `src/bookings/payment.ts` (default: no payment
  step; three exports `paymentNote`, `paymentHoldMinutes`, `startPayment`), `createAppointment(…, { holdMinutes })`,
  `confirmHeldAppointment`, `releaseHeldAppointment`, and an E2E submit step `tests/e2e/booking-payment-step.ts`.
  The payment component replaces both through `files-with/domain.bookings.turbineh/` (ADR-0041), so the bookings
  suite runs unchanged in a paying app (it pays on an offline stand-in of Stripe's hosted page).
- Selected **by code** (`detectDomains`, like the bookings domain) for the bookings recipe when a sentence asks
  customers to pay by card / a deposit when they book, with params from the request (amount, percent or full price;
  stated assumptions otherwise). Not for ai-agents: bookings made by the AI assistant or by staff are not charged
  (listed in the guide's limits). Probe in `DOMAIN_PROBES`, so `verify:recipe --all` and CI check the combination.
- **Canonical criteria known at the gate.** `gateComponents(prompt, recipe)` (the domain components code will select)
  are now part of `canonicalizeSpec` and of the scope gate's `provenByTests`, so a requirement a selected component's
  test proves is covered by code before the decider is asked — the same set the assembly links later.

### 2 · Storefront: the functions requests ask for, each with its test

- New canonical criteria with new E2E tests: `storefront.card-payment` — the shopper pays by card on Stripe's page
  (offline stand-in), the session carries the server's lines and prices, and the success page shows the paid order
  (only to the browser holding its session id) — and `storefront.variant-sold-out` — a sold-out size is disabled and
  the server refuses it even from a tampered page. The admin-orders test now also asserts the customer's email and
  the items bought.
- Declared vocabularies widened only where the existing tests prove the words (discount value, minimum, expiry date,
  usage limit; currency configuration; shipping methods per destination; Stripe Tax enabled with an address; cart
  stored in the session; orders recorded; SKU stock edited by the admin). `canonical.test.ts` still proves every
  canonical wording against its test (`proofVerdict`), and the actor guard is unchanged (a customer viewing the admin
  dashboard stays open).
- The commerce functions (variants with SKU/price/stock, discount codes, fixed prices per currency, shipping by
  country, taxes by country or Stripe Tax, Stripe Checkout, orders and stock) stay in the recipe template rather than
  separate `commerce.*` components: each modifies the cart, the quote and the order the others use, so none can be
  delivered or verified alone; their proof is the recipe's suite.

### 3 · Images: the storefront provides `storage.objects`; Blob in production, PostgreSQL otherwise

- `storefront` ships its own `package.json` + lockfile (the overlay pattern of ai-agents; base dependencies kept at
  the same versions, checked by `recipe-overlays.test.ts`) with `@vercel/blob@2.8.0` (Apache-2.0, published
  2026-08-10, 0 OSV advisories; its transitive `undici` pinned to 6.29.0 by override so every resolved version is more
  than 14 days old) and declares `storage.objects` as provided, so no library is selected and no glue written.
- `src/server/images.ts`: with `BLOB_READ_WRITE_TOKEN`, uploads go to Vercel Blob (`put`, public, content type from
  the bytes; the URL in `products.image_blob_url`; a replaced image is deleted with `del`); without it the bytes stay
  in PostgreSQL and `/shop/images/<id>` serves them — the sandbox and local development use this real path. Unit
  tests drive the official SDK against a local stand-in of the Blob API (`VERCEL_BLOB_API_URL`): exact upload
  request, delete, refused token, no network call without a token.
- `storage.objects.vercel-blob` itself (used by other recipes) gets curated `glue.ts` (`storeObject`,
  `deleteObject`, strictly typed, copied verbatim — no model call) and contract tests of the `put`/`del` requests and a
  refused token, run with the glue's type check in the certification sandbox.

## Consequences

- Booking requests that ask for card payment at booking time are covered when the rest of the request is; SMS
  reminders and native apps are judged on their own (other components, or never). Bookings created through the AI
  assistant or by staff are not charged.
- Every app with the payment component needs a Stripe account and a webhook endpoint; an abandoned payment holds a
  time for the Checkout lifetime (at least 30 minutes) plus 5 minutes. If the app also has subscriptions, each route
  needs its own Stripe endpoint and secret (they share the setting name).
- Not proven: live Stripe and live Vercel Blob (mocks and stand-ins of the documented requests only; no credentials
  are committed or needed).
- Tests: `apps/worker/src/commerce-coverage.test.ts` (synthetic shop and booking-payment requests through
  canonicalization and the scope gate), `packages/compiler/src/domains.test.ts` (payment detection),
  the component's unit and E2E suites, the storefront's `image-storage.test.ts` and new E2E tests; full gate via
  `verify:recipe storefront` and `verify:recipe bookings+payments.booking-deposit.turbineh`.

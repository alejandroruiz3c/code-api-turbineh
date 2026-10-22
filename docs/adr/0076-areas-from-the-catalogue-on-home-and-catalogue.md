# ADR-0076 · The home and the catalogue show each area's verified functions and add-ons, from the catalogue

- Status: accepted
- Date: 2026-10-22
- Amends: ADR-0063 (canonical criteria: optional `label`), ADR-0033 (component guides: optional `name`, `tagline`),
  ADR-0069 (example guard: the home's examples)
- Context: the home of software.turbineh.com did not show what the library builds, and `/catalog` showed the 11 use
  cases with `sections` (recipe nav labels) that were incomplete — bookings, saas-crud and internal-tool showed none —
  and without the functional components added by ADR-0069…0075 (blog, screen recording, matching, IMAP inbox, mailbox
  triage, recommendations, reminders, SMS, WhatsApp, card payment at booking). Discover's copy (`lib/use-cases.ts`)
  was written by hand, with its own names, summaries and examples no guard checked. Owner principle: every piece of
  information shown is real; nothing offered or claimed for its own sake.

## Decision

### 1 · One generated index of areas, functions, add-ons and totals

`pnpm --filter @turbineh/engine gen` (packages/engine/scripts/use-cases-source.ts) now also reads catalog/components
and writes, into `use-cases.generated.ts`, for each use case (recipe):

- `name` and `tagline`: recipe.yaml `title` and `tagline` (one line).
- `functions`: the area's verified functions — the canonical criteria (ADR-0063) of the recipe and of the components it
  always installs (`requiredComponents`), grouped by label, in declaration order. A `same:` criterion shows the
  function another criterion proves. `when: ai` criteria count only where the app has the AI orchestrator (the AI
  booking tools are not a function of a bookings site without AI). Bookings, saas-crud and internal-tool now list what
  they do.
- `addOns`: the approved components that have `criteria.yaml` (functions proved by tests) and list the area in
  `capability.use_cases`, except those the area already installs; each with its guide's `name`, `tagline` and its
  functions. The generator fails when such a component has no `name`/`tagline`.
- `CATALOG_TOTALS`: approved components, complete use cases, and functions proved by tests (canonical criteria of
  recipes and approved components with their own linked tests; `same:` criteria are not counted twice). Never a bench
  figure, never written by hand.

The label of a function is the criterion's `advertises` words (leading article dropped, first letter capitalised), or
its optional `label` when `advertises` is a fragment of a sentence ("enter it" → "Manual data entry"). The proof
(criterion ids and linked tests) stays in the generator's source objects for CI; the web ships only labels. The index
is also exported as `@turbineh/engine/use-cases` (data only, safe in client components).

### 2 · Surfaces

- Home: "What you can build" after the steps — the totals line ("N verified components · 11 complete use cases · M
  functions proved by tests"), and one card per area: name, tagline, up to eight function chips (the rest one click
  away on `/catalog#<id>`) and "Extend with" links to `/discover?q=<component id>`. The "Try" examples are now
  requests that open a new flow, one per area the new components extend.
- `/catalog`: the same functions replace `sections`, and "Extend with" lists each add-on with its tagline and
  functions. `GET /v1/capabilities/{id}` returns `functions` and `addOns` for a use case.
- Discover (`lib/use-cases.ts`): names, summaries (taglines), functions, keywords and examples come from the index; only
  the environment requirements stay in the web app. The example is the use case's guarded catalogue example.

### 3 · CI

- `packages/engine/src/areas.test.ts`: every function comes from canonical criteria each linked to a test; no criterion
  of an area is left out; add-ons are exactly the approved functional components of the area; totals are recomputed;
  taglines (recipes and add-ons) use only words of the catalogue text and of the proved functions.
- `apps/worker/src/example-prompts.test.ts` reads the home's `EXAMPLES`; each has a compiled-shape fixture, passes the
  scope gate covered with every requirement proved by a shipped test.
- Home and catalogue render tests: every area, its functions, add-ons and the computed totals; no prices.

## Consequences

- Adding a component with criteria and `use_cases`, or a criterion to a recipe, updates the home and the catalogue on
  the next `gen` (the sync test fails until it is run); nothing on those pages can drift from the catalogue.
- Recipe names on every surface (search, CLI, MCP, product help) are the recipe's `title` ("Online store",
  "Bookings and appointments"…) instead of names derived from the id.
- A short `tagline` is reviewed copy, but bounded: the CI word check keeps it to what the catalogue already says.

# ADR-0063 · Canonical acceptance criteria and functional coverage as a first-class dimension

- Status: accepted
- Date: 2026-10-16
- Context: external audit v2 (16/10/2026), findings N-01, F-01, N-04, N-05, F-14, N-06. A bookings flow (52eff6c8) met
  2/5 requirements although the recipe's E2E proves the three functions the catalogue advertises (public booking page,
  confirmation email with a cancel link, no double bookings): the planner rephrased each requirement and the
  word-for-word matcher (ADR-0039/0045, precision first) could not see that "a patient books a 45-minute session" is
  what "a customer books a free time on the public page" proves. The staging dry run of the go-validation benchmark
  (PR #121, A01/B01) reproduced it: 7/11 and 3/5, both labelled `verified`. Meanwhile "verified" kept meaning only
  "the build checks passed" (F-01), the home KPI still read "2/2 Flows verified" with 0/15 requirements (N-04), a
  detailed specification in a domain the library does not cover was built at 0/15 (N-05), library contract tests could
  stand in for business criteria (F-14), and status texts differed per surface (N-06).
- Owner principle: the functional intent requested is what we deliver; every piece of information shown is real;
  nothing offered or claimed for its own sake.

## Decision

### 1 · Every advertised function has a canonical criterion linked to the test that proves it

Each recipe, and each domain component a recipe relies on, ships `criteria.yaml` (next to `acceptance.yaml`):

```yaml
- id: bookings.public-booking
  criterion: "A customer books a free time on the public page without an account and the booking is created"
  advertises: "public booking page" # words of the catalogue text this proves
  says: ["\\bbook|appointment|…", "public|online|…"] # all must match a request criterion to map here
  terms: slot session minute select pick … # words requests use for this function
  actors: [customer, client, patient, visitor, guest]
  tests: ["tests/e2e/bookings.spec.ts › a customer books a free time on the public page …"]
```

- `generated:` links a function the assembler generates per entity (saas-crud's CRUD screens: create, list, edit,
  delete, CSV export/import, search, tag filter, sort, tenant isolation) to that entity's generated test, by title
  pattern; `{entity}` in the wording is the request's entity. `when:` (`ai`, `open-sign-up`) limits a criterion to the
  apps where its test runs. `same:` lets a recipe claim an advertised function another canonical criterion of its chain
  proves (the internal tool's "search" is saas-crud's).
- CI audit (`packages/assembler/src/canonical.test.ts`): for all 11 recipes, every function of the catalogue text
  (`advertisedFunctions` of recipe.yaml's description, the text the catalogue and Discover show) is claimed; every
  linked test exists in the package the recipe assembles; at least one linked test proves the canonical wording under
  the unchanged `proofVerdict`; each canonical wording maps to itself; generated CRUD canonicals are proven by the
  generated tests. Functions that existed but were untested got tests (tracker weekly totals and history, client-portal
  client/staff flow, landing confirmation email, analytics manual entry, AI batch summarise/extract and allowed tools,
  storefront uploaded image, projects assignee/priority/due date assertions, generated delete and tenant-isolation E2E,
  "any team member" assignment in bookings). No advertised function was missing; no claim was removed.

### 2 · The plan reuses canonical criteria; matching is a declared link

- Right after compiling (before the scope gate), `canonicalizeSpec` replaces each request criterion that maps to the
  use case's canonical criteria with their wording; the request's words are kept in `spec.criteria_asked` and shown as
  "asked as". A request criterion maps only when every `says` pattern matches, every role it names is served, a refusal
  it states is a refusal the canonical criterion states, and **nothing of it is left over** once the canonical wording,
  its tests' titles, `terms`, `actors` and the app's declared aliases (ADR-0047/0049: params, role names) are absorbed.
  A leftover word ("…and pays a deposit", "…WhatsApp reminder") keeps the criterion out. Ties go to the canonical
  criterion whose own wording the request expresses most; a criterion that states two functions maps to both.
- At assembly `linkCriteria` links criteria (canonical or not) to canonical criteria present in the package, with the
  package's aliases; `.turbineh/acceptance.json`, ACCEPTANCE.md and turbineh.json carry `canonical` and `asked`. A
  linked criterion is met exactly when its linked tests are in the package and the gate passed. The rest keep the
  previous path (proof by title, ADR-0045) and only those residual criteria go to the resource decision engine
  (`linkedCriteria` are never sent to `matchCriteria`). The report's criteria are rewritten from the guide, so the web
  "What works" list, TURBINEH_REPORT.md, turbineh.json and the API say the same.

### 3 · Functional coverage on every surface; "verified" only with a qualifier

- `functional_coverage = criteria a passing test proves / criteria derived from the request` (after scope).
  Library contract tests (`tests/unit/components`) are no longer evidence for any criterion. Coverage is counted by
  criteria, not tests: one linked test per criterion.
- One source of status texts, `packages/shared/src/status-texts.ts`: `verdictLabel` ("Verified · checks 11/11 ·
  functional 9/10" at ≥ `FUNCTIONAL_THRESHOLD` = 80 %, "Technically verified · checks 11/11 · functional 2/5" below,
  "Not verified · …" when the gate failed), `STATE_TEXT` (web badge and CLI line; "Integrated & verified" became
  "Integrated · checks passed"), `FLOW_STEPS` (/use step 4 "Checked result", not "Verified result"), `KPI_TEXT` and
  `ellipsize` (word-boundary ellipsis; engine messages, scope requirements, CLI lists).
- Exposed as `outcome.functional {met,total,ratio,threshold}` and `outcome.badge` (API, CLI `--json`, MCP, web) and
  `functional_coverage {met,total,ratio,label}` in turbineh.json (its `status` stays the technical gate, documented).
- Home and Activity: "Flows verified" → "Checks passed (flows)" and "Requirements met (aggregate)".

### 4 · Functional floor in the scope gate (N-05)

A use case is built only when at least one requirement maps to a verified function (a canonical criterion or a
shipped test). Otherwise every requirement is reported not covered ("0 % functional coverage") and nothing is built —
a detailed specification is refused exactly like a vague one. The components-only offer for uncovered requests
(ADR-0062) applies to these refusals unchanged.

## Consequences

- Deterministic first: the decider sees only residual criteria. Precision guard unchanged (`proofVerdict` still
  proves every canonical wording against its test in CI); recall moves to declared vocabularies reviewed with the
  recipe. A request that uses words no canonical criterion declares stays open: add the words to `terms` when the
  test really proves them, never otherwise.
- Service durations, team-member choice and similar request facts are absorbed when the function is parameterised by
  them (bookings params); the generic test runs with this app's params.
- Measured values (staging, `bench/functional`): see the PR and `bench/functional/runs/`.
- Not done: domain components other than bookings, workflow, membership-access and audit-log have no canonical
  criteria yet (their acceptance.yaml rules keep working as before).

# ADR-0075 · The plan promises what the package proves: proofs survive tree-shaking, use-case-only requests, compiled wording

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-21
- Amends: ADR-0063 (canonical criteria), ADR-0064 §3 (tree-shaking), ADR-0069 §2 (use-case requests), ADR-0052
  (what "covered" tells the person), ADR-0073 (requests built on the closest template)
- Context: real requests were re-run through the public flow (plan → generate) on staging after ADR-0069…0074. Every
  one passed the scope gate as `covered` and the plan linked most criteria to shipped tests, yet the delivered packages
  measured far less functional coverage: the web's own support-assistant example 1/3, the catalogue's AI-agents example
  10/13, a two-word store request 3/11 and a two-word portal request 2/5 with criteria the compiler invented, a B2B
  request 1/12, a full shop not verified because one E2E failed, and a screen-recorder request delivered as parts for a
  project that was never given (no functional coverage at all).

## Diagnosis (root causes)

1. **Tree-shaking removed the proof the plan had counted.** The plan resolves canonical criteria against the
   catalogue's templates as they are; the package is tree-shaken (ADR-0064) by the relevance step, which keeps an
   optional module only when a requirement "asks for it". "Answers from the help centre" did not literally ask for "a
   knowledge base of uploaded documents", so the `knowledge-base` module of the AI template — and the E2E tests inside
   its `turbineh:module` markers — was removed. `linkCriteria` then (correctly) found no test, and the criteria the plan
   called covered were delivered open. `covered: 0` in the metrics only means the gate passed (covered becomes met);
   the loss is in `open`.
2. **Request words that name a function were absorbed as context.** `requestWords` keeps the request's subject words
   so the residual check can absorb them; "escalates" and "human" were among them, so the hand-off criterion of the
   support assistant mapped to "answers from the knowledge base" (the closest wording once those words were absorbed).
3. **Use-case-only requests kept the compiler's guesses.** ADR-0069 used the use case's canonical criteria only when
   every compiled criterion was a general requirement. For "online store"-like requests the compiler writes a dozen
   specific criteria ("Recent Activity", "a Support form") that nobody asked for; they were built and measured.
4. **Compiled Given/When/Then wording missed canonical criteria by one or two narrative words** ("a secure login flow",
   "at least three", "subsequent uses", "a request is made", "switch organization contexts", "action type"), and
   "AI answer engines" / "llms.txt" in the corporate site's own canonical criterion read as AI generation.
5. **The account-page E2E asserted the literal label "Owner"**, but the role labels are the request's (a shop's owner
   is labelled "Admin"), so every request with its own role names failed the gate.
6. **An empty environment was treated as an existing project.** With no repository, no files and no declared stack, a
   request no product family matched was planned as components to integrate into "your project".
7. **"Covered" read as "every function proven"**: the plan said "Every requirement of the request is covered by the
   library" while its own criteria list had open ones.

## Decision

1. **A module whose tests prove a planned criterion ships** (`modulesForTests` in the assembler, `proofModules` in the
   worker): for each criterion the plan links to a canonical criterion, the linked tests are located in the catalogue
   (a module's files, or between its `turbineh:module <id>` markers); the module's capability is justified by that
   criterion (`kind: criterion`), removed from "not selected", and kept by tree-shaking. Deterministic; applied both
   when planning and when generating from an approved plan.
2. **Function words are never request context**: escalate / hand-off / human join `FEATURE_WORD`. Closeness ranks a
   canonical criterion by its wording and the catalogue words it proves (`advertises`), so "an option to escalate to a
   human" is the hand-off, not the tool registry that also lists that tool.
3. **A request that only names the use case, or is its catalogue text, gets the use case's canonical criteria**
   (`asksForTheUseCase`): every word that names something is the use case's name or a catalogue keyword (plus words
   that state no function: "a simple online …"), at most four, or the request is the catalogue text itself. The
   criteria are the recipe's own canonical criteria (a use case whose functions are its domain component's — bookings
   — gets those), without conditional ones (open sign-up, SMS…). Anything more specific keeps its own criteria.
4. **Narrative words of compiled criteria** are absorbed (secure, flow, platform, context, least, single, currently,
   dedicated, subsequent, made, set, based, initial…), and terms were added where the function is the same and its test
   proves it: organization switching without other tenants' data, role permissions, profile + matches with
   geographies, audit entries with the action type, booking confirmation, double booking answered with a validation
   error, chat that references the knowledge base, AI usage events, an archived project kept, the booking assistant's
   contact details, buyer preferences and record details. "AI answer engines", "AI crawlers" and "llms.txt" are what
   reads a site, not AI the app runs. A browser refresh that still shows the data is the persistence general
   requirement.
5. **The account-page E2E checks the role by its stored key** (`data-role` on the active organization's row, the same
   key the dashboard shows) and that it has a label, whatever the request calls it.
6. **An empty environment is a new app**: only a connected repository or files that tell the project (language,
   framework, package manager or versions) make a plan "parts for your project"; otherwise a request no family matched
   whose functions verified components prove is built on the closest template (ADR-0073).
7. **The plan states the functional coverage it expects**: `scope.functional {proven, total}` from its own criteria,
   and when some are open the message says "Every requirement of the request is within what the library covers: N of
   M functional requirement(s) are proved by tests shipped with the library; the other K are delivered open, each with
   where to implement and prove it."

## Consequences

- Delivery replay of the 15 real requests (local: stored compiled specs with the request's own wording, plan logic of
  each branch, assembled as the worker does, `.turbineh/acceptance.json` of the package): see the PR for the table.
  On main the replay reproduces staging (support assistant 1/3 with 2 criteria the plan called covered delivered open;
  AI-agents example 4 such criteria). On this branch no criterion the plan calls covered is open in the package.
- Still open, honestly (no test proves them; the plan now says so before generation): saved searches, notification
  preferences, a platform-wide administrator, usage analytics, a category filter and an "important" feedback option in
  the B2B request; an SMS reminder and a cancellation without the email link that the compiler added to a two-line
  booking request; a region named by its demonym ("Spanish") in the real-estate assistant; citation copy in the blog.
- Regression tests with synthetic, paraphrased fixtures: `apps/worker/src/delivery-coverage.test.ts` (module kept and
  every planned criterion linked in an assembled package; use-case-only requests; empty environment; plan message),
  `packages/assembler/src/canonical.test.ts` (module location, hand-off precision, compiled wording, negatives),
  compiler (persistence on refresh) and engine (AI readers) tests.

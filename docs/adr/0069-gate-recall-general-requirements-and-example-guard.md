# ADR-0069 · Scope-gate recall: general requirements, canonical vocabulary, AI as a topic, product questions and a guard on our own examples

- Status: accepted
- Date: 2026-10-21
- Amends: ADR-0063 §2 and §4 (canonical mapping, functional floor), ADR-0052 (what the gate reads), ADR-0068 (agent
  lookup tools and escalation get canonical criteria)
- Context: production analysis of every request since 2026-10-13. The functional floor of ADR-0063 §4 refused with
  "0 % functional coverage" requests the library covers: the wizard's own suggestion ("A support assistant that
  answers from our help centre and escalates to a human", five times), each use case's catalogue example ("A runnable
  … app with sample data (…), verified in the TurbineH sandbox."), the AI agents use case described in its own
  catalogue words, and a to-do app with projects asked in another stack (four times). A blog _about_ AI was refused as
  "AI generation", and a question ("what can I do with you?") was recorded as a failed build and uncovered demand.

## Diagnosis

No requirement of those requests mapped to a canonical criterion, so `provenByTests` was empty and the floor sank
everything. Causes, per request class:

1. **Non-functional words counted as functions.** "Runnable", "sample data", "verified in the sandbox", "good
   practices", a visual style and "data persists after a refresh" were acceptance criteria with no test — and could not
   have one.
2. **Missing vocabulary in `ai-agents/criteria.yaml`.** No `vocabulary` entry, so "AI", "assistant", "query",
   "orchestrator", "help centre" were leftovers of every criterion; no canonical criterion for help-centre answers,
   hand-over to a person (only "…emails the team"), lookups (ADR-0068 had generated the tool without a criterion) or
   "every AI call through the orchestrator".
3. **Generic narrative left over.** "Interacts", "triggers", "performs", "details", "permanently", "saved", "refresh",
   "opens", "request"… describe how a requirement is told, not a function.
4. **Stack words left over.** "Saved in the SQLite database", "removed from the JSON file / the DOM".
5. **Matching rules too blunt.** A negation inside a condition ("a question that cannot be answered") was read as a
   refusal; a person the actor picks ("picks a service and a team member") was read as an actor; a criterion stating
   three functions found no pair because the two-function search was greedy; domain components the request selects
   (bookings) were not seen by the gate (only after it).
6. **Projects had no archive** and no tested edit/delete of projects or tasks.

## Decision

### 1 · General requirements are listed, never measured as functions

`packages/compiler/src/general-requirements.ts`: a criterion is _general_ (`runnable`, `verified`, `sample-data`,
`good-practices`, `look-and-feel`, `persistence`) only when it names one of these qualities and **no function** (a
criterion that creates, edits, books, pays… stays functional). The worker moves them to `spec.general_requirements`
before canonicalisation and the gate (`withGeneral`), each with how it is handled — honestly: sample data is **not
included** (apps start empty), a named style is not generated (the brand applies), persistence is PostgreSQL. A stack
the request names (HTML/Bootstrap, SQLite, a JSON file, PHP…) is never a refusal: the plan says the app is built on
`SUPPORTED_STACK` (TypeScript + Next.js + PostgreSQL + Drizzle, now one constant in `@turbineh/shared`) and that the
data is persisted in PostgreSQL instead. `Plan.general` carries them; the web plan ("General requirements") and the CLI
show them. A request that names the use case and only general qualities asks for the use case as advertised: its
criteria become the use case's own canonical criteria.

### 2 · Canonical mapping: vocabulary where the tests prove it, generic narrative absorbed

- `ai-agents`: vocabulary (AI, assistant, query, conversation, orchestrator, help centre, FAQ…) and new canonical
  criteria, each with its test: `help-centre` (E2E: answers from an FAQ article and cites it), `escalate-human` (E2E:
  the team is emailed — outbox —, the conversation is listed under "Needs a person" for the team, the user is told a
  person will follow up), `lookup` (generated per looked-up entity, `generatedIn: tests/unit/agent-tools.test.ts`, one
  generated test per tool) and `orchestrated` (unit: no app module calls a model directly; the Safety Pack checks the
  request before the model). Terms added only where those tests prove them.
- Escalation is honest: "emailed" only when every team address was really delivered; the deterministic AI simulator
  (`services/ai-mock`) chooses `escalate_to_human` / `lookup_<entity>` from the offered tools, so the E2E proves what
  the app does once a tool is chosen.
- `projects`: archive and restore of tasks and projects, project rename and delete (with its tasks), task archive —
  implemented in the template with E2E; canonical criteria for each; catalogue text updated.
- `canonical.ts`: storage phrases removed before matching; a negation inside a condition is not a refusal; people the
  actor picks are objects, not actors; the two-function search tries every pair; more narrative words absorbed.
- The gate and the canonical wording see the domain components the request selects (`gateDomains`).

Precision guards of ADR-0063 are unchanged (says, two own words, actors, refusals, nothing left over; `proofVerdict`
in the catalogue audit) and new negative tests pin them (SMS escalation, routing to a premium model, a member reading
escalations, a lookup of an entity that does not exist, Trello/WhatsApp to-dos). The components-only offer precision
test (ADR-0062, precision 1.0) is green.

### 3 · AI as a topic is not AI generation

`asksForAi` (scope gate): a mention of AI is a topic when it names what content is about ("AI research insights", "a
newsletter about AI", "un blog sobre IA"); any other mention — "AI-powered", "an AI that answers", "AI research
assistant", "uses AI to tag" — is still a function and refused in a use case without AI.

### 4 · Product questions get a help answer

`isProductQuestion` (engine, whole-message patterns in English and Spanish, precision first) and `productHelp()`
(the use cases with their example). `POST /v1/builds` and `POST /v1/plans` answer 200 `{kind: "help", help}` before
any row is written (no flow, no failed build, no demand row); the CLI (`build`, `plan`: exit 0, `state: "help"`), MCP
(`build` result, not an error) and the web wizard (help panel with clickable examples) say the same.

### 5 · Our own examples can never be refused again

Each use case's example is now its catalogue text (a functional request; "with sample data" was a promise the apps do
not keep). `apps/worker/src/example-prompts.test.ts` collects every example prompt we show — the wizard's suggestions,
every use case's example (Discover, /use, the help answer), the README's and the API page's — requires a compiled
fixture for each (`example-prompts.fixtures.ts`: the compiler's real output where production compiled it, otherwise
written in its format), runs it through the gate exactly as the worker does (`gateOffline`, code only) and requires
`covered` and every functional requirement proved by a shipped test unless the fixture lists it as `open` with the
reason (four reviewed: a suggestion of the next free slot, three wordings of the storefront owned by the commerce
workstream, a criterion with two actors).

## Consequences

- Offline replay of the 17 target builds (stored compiled specs, catalogue of this branch, no decision engine):
  16/16 build requests covered (15 refused on main, 13 of them at 0 %), every functional requirement proved by a test
  in 14 of them (the AI-research blog's own blog functions and the B2B request remain partly open); the product
  question gets the help answer. The B2B request keeps its open business functions (organisation
  switching, role assignment, matching), only generic wording was in scope.
- More words are absorbed, so recall rises everywhere; the guard and the negative tests are what keeps precision.
- Not done: seed/demo data (not a function, said as not included); a test proving "suggests the next free slot".

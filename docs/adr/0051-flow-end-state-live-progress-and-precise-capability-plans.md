# ADR-0051 · The flow page always ends, says what is happening, and capability plans select only what the need asks

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-13
- Context: production incident, 2026-10-13 23:39 UTC. The owner planned "Small fetch-based HTTP client with retries
  and timeouts for external APIs" on a connected repository (Next.js 15.5.26, npm) and generated it. The page stayed on
  "Assembling verified components · Packaging" with no end state, as if hung. The production row (`470bc606`) shows
  the work finished in 1.5 s: `queued {mode: generate}` → `assembling start` → `delivering done {channel: package}` →
  `finished {status: done}`, no verify step. Three causes:
  1. **No end state for capability packages.** A component-only generation stores only `artifact.package` (no app
     ZIP), so `/v1/builds/{id}` returned `artifact: null`; the flow page rendered a result only for an app ZIP or a
     failure, so a finished capability package showed nothing but the trace (and a "Package verified" badge).
  2. **Nothing said what was happening.** The trace listed phase names with coloured dots; phases without events
     stayed grey forever (understanding and decisions happened in the plan run), there was no elapsed time, no detail
     and no safety net when the stream went quiet.
  3. **Loose selection.** The component plan took every keyword-search hit with a score above zero, up to six: one
     shared word ("small", "client", "fetch", "external") was enough, so the HTTP-client need also got a cart store,
     react-query, fuzzy search, email and a request queue. "generat", "model" and "extract" in a need also pulled the AI
     orchestrator (e.g. "Generate QR codes").

## Decision

### 1 · The flow page always reaches an end state (web)

`lib/flow-follow.ts` follows a flow, framework-free and tested with a fake event stream:

- the row is loaded first, so a late subscriber renders the final state from the API before (or without) any event;
- live events are deduplicated by id; a `finished` event reloads the row and, if it is still `queued`/`running` (the
  plan's own finish, or the event raced the row update), the trace is followed again;
- a dropped stream is reopened;
- **safety net:** after 15 s without events while the row is in progress, the API is polled every 10 s; a `done` or
  `failed` row is rendered even if the stream never says so.

End states: an app ZIP → the existing result; a capability package → the package result below; a failure → "What
happened"; anything else that finished → a "Result" panel with the outcome and links (never a blank page).

### 2 · Live messages during the process

`lib/flow-progress.ts` turns the latest run's events into plain language: one line for the step running now with live
details (components being assembled by name, files written, glue and missing parts written "k of N", which gate check
is running and the gate order, each check's result, duration and passed-test count), the elapsed time, the step's
typical duration and the next step. The step list says done / now / next / later / skipped in words, not only colours;
a generation run marks understanding and decisions "done · from your plan". After 20 s without events: "Still running
<step>… this step usually takes ~N", "Keep this page open or come back later: we'll keep building" and a link to
Activity. No spinner without text.

Events added (cheap, one row each): `assembling start {components}` for apps; `integrating progress {gap, index,
total}` per missing part written; `verifying step {name, state: start|done, ok, ms, tests}` for every gate step (the
sandbox's `step()` prints `PROGRESS begin|end` on stderr, streamed by `run(…, onLine)`) and for the security scans.
Typical durations: `GET /v1/activity/timings`, the median per phase over the last 14 days of finished flows (at most
300, apps and capability packages apart, ≥ 3 samples), cached 10 minutes — durations only, no cost.

### 3 · Capability package for a repository: verified in the sandbox, or "not verified yet"

PLAN §16.2 defines `verified` as "package generated and verified in the sandbox"; the components' certification is
per component and earlier. The certification harness is cheap for a package (one workspace: install with network and
no secrets, then the contract tests and strict type check with `--network none`; the HTTP-client package is one
component). So **the package's contract tests run at generation** (`runContracts`, extracted from `certify` with no
catalog side effects, `apps/worker/src/component-package.ts`), with live `verifying step` events (install →
contract → typecheck):

- all pass → state `verified`: "Package ready and verified: its contract tests passed in the TurbineH sandbox";
- no sandbox, install unreachable, or no component with a contract test (TurbineH modules are checked in complete
  builds) → state `generated`: **"Package ready (not verified yet: it is verified inside your project when you
  integrate it)"**;
- a contract test fails → `generated`, delivered with the failing component and a `verification_failed` error.

Rows generated before this ADR (only the `certification` check) are `generated`, no longer `verified`.

Every surface says the same: `flowOutcome(row)` in the engine (deterministic) builds the outcome from the same row as
`flowState` — `kind`, `state`, `title`, `meaning`, `verification`, `actions` and `left`. It is returned as
`FlowResult.outcome` (`/v1/plans/{id}`, CLI `turbineh status <id>` prints its title) and as `outcome` next to `state`,
`problem` and the new `package` link on `/v1/builds/{id}`. Actions for a package: **Open a pull request** (GitHub
connected; draft until every check passes inside the project), **Download ZIP**, and **`turbineh apply <id>`** with
what it does (writes `turbineh/<slug>/` on a new branch in one commit, adds only missing dependencies and setting
names, never touches the default branch; `turbineh verify` / `turbineh revert`). "What is left" lists verification in
the project (when not verified), wiring (agent/INTEGRATE.md), settings and the plan's open parts.

### 4 · Component plans select only what the need asks for

`componentsForNeed` (engine, deterministic, never a model): each word of the need is stemmed the same way for every
form ("parse/parses/parsing", "retry/retries", "format/formatting") and weighted by how rare it is in the catalog
(inverse document frequency); a word in the component's capability name (id, provides) counts double. The best
component is taken; another one only when it names, in its capability, a word of the need the chosen ones do not cover
and those uncovered words are worth at least half of the best score — a second capability of the need, never a shared
common word. Declared dependencies (`relations.requires`) are added. The inference test no longer matches "generat",
"model" or "extract" (plain code), only AI words (ai, llm, language model, chat, agent, assistant, summarise,
classify, translate, embedding, rag, prompt, generative).

Measured on 10 short single-capability needs labelled by hand (`pnpm --filter @turbineh/worker run
bench:component-plan`, `bench/results/2026-10-13-component-plan-{before,after}.json`): precision **22.2 % → 100 %**,
recall (the required component selected) 100 % → 100 %. The HTTP-client need now selects `ops.http-client.ky` only
(retries and timeouts are built into ky).

## Consequences

- A capability generation takes longer when it runs its contract tests (one sandbox install); the trace says so step
  by step. Without Docker or registry access it still delivers, as "not verified yet".
- The ten labelled needs are also the regression test (`apps/worker/src/component-plan.test.ts`); the cases were
  written before the fix and the scoring was tuned on them, so new cases should be added when a need selects badly.
- Tests: `apps/web/src/components/flow-finish.test.tsx` (the exact production event sequence through the follower and
  the rendered end state; late subscriber; finished-before-row race; reconnect; safety net; live messages; silence;
  no spinner without text), `apps/worker/src/component-package.test.ts` (events, states and outcome on every
  surface), `packages/engine/src/need-match.test.ts`, `packages/verifier/src/progress.test.ts`.

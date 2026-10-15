# ADR-0033 · Agent runtime, domain components and acceptance proofs

- Status: accepted
- Date: 2026-10-13
- Context: Frontiers bench, Capability B (`bench/frontiers/ANALYSIS.md` §3.2, items A1–A6). With our package, a coding
  agent still deleted our generic bookings CRUD, wrote slots/policies/tools, its own OpenAI-compatible client (bypassing
  the orchestrator), a mock model for E2E, a public chat with limits and a staff allow-list. Owner priority: TurbineH
  must plug into a coding agent's flow with zero extra work, and the fix must improve every current and future
  component, not one demo.

## Decision

### 1 · `runAgent()`: one tool-calling runtime for every AI app (component `ai.orchestrator.turbineh` 0.2.0)

- `src/lib/ai/agent.ts`: `runAgent({ instructions, input, tools, state, confirm?, … })` runs one turn: AI Safety Pack
  (size, injection refusal, per-user/workspace limits), one routing decision (route + unsafe) by TurbineH orchestration,
  then a bounded loop (default 6 steps, max 12; 60 s per run; 10 s per tool; 4 calls per step).
- Tools are `defineTool({ name, description, parameters: zod, execute, irreversible?, prepare? })`. Arguments are
  validated before anything runs; unknown tools and invalid arguments go back to the model as errors.
- **Irreversible tools are never executed on the model's say-so.** Their `prepare()` validates against real data and
  returns a summary; the run ends with `status: "needs_confirmation"`. Code executes the tool only when the person's
  next message is an explicit short yes (deterministic reading) or a Confirm button (`confirm: true`); anything else
  drops the pending action. Pending actions expire after 30 minutes.
- State (`messages`, `pending`) is returned to the app and stored server-side (`agent_sessions`, `sessions.ts`); the
  browser only holds an unguessable id.
- Model endpoint by configuration only: the TurbineH AI gateway by default, or any OpenAI-compatible endpoint with
  `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`. A spec asking for "an OpenAI-compatible endpoint configured by environment
  variables" is therefore satisfied by the orchestrator, never by a hand-written client. Model names stay inside our
  orchestration (open models by default).

### 2 · Domain components expose tools as a Toolkit (reusable pattern)

- A domain component (category `domain`, e.g. `domain.bookings.turbineh`; next: orders, CRM, tickets) ships:
  - `files/`: the domain itself (rules in plain functions, tables in `src/db/component-<domain>.ts`, staff pages behind
    `requireAdmin()`/`currentAdmin()` from `src/server/authz.ts`, unit tests). Works without AI.
  - `files-ai/` (copied only when the app has `src/lib/ai/agent.ts`): `src/<domain>/toolkit.ts` exporting
    `toolkit: Toolkit = { id, title, audience: "public" | "staff", instructions, tools }`, a mock-model script
    `tests/mock-llm/scripts/<domain>.ts` and the E2E suite of the assistant.
  - `acceptance.yaml` (criteria → tests) and `guide.yaml` (see 4).
- The assembler writes `src/lib/ai/toolkits.ts` listing every installed `src/<domain>/toolkit.ts`. Public toolkits
  power `POST /api/assistant`, `/assistant` and the home-page widget of recipe `ai-agents` (no sign-in; per-IP rate
  limit, message size, turns per conversation, on top of the AI Safety Pack). Staff toolkits are used from server
  actions behind `requireMember()`.
- **Selection and parameters by code.** `detectDomains(prompt, recipe)` (compiler) recognises the domain and extracts
  its parameters deterministically (bookings: business name, team noun and size, customer noun, durations, hours per
  weekday, IANA time zone, notice policy, services and prices, questions to answer). Anything the request does not say
  is a documented default listed in the README ("Defaults used"); facts are never invented (unknown answers stay
  `null` and the assistant says so). The pipeline adds the component to the recipe's required components; the
  assembler writes `params.json` and treats the domain's entities as provided (no duplicate generic CRUD).

### 3 · Shared scripted mock model

`tests/mock-llm/` ships with the orchestrator in every AI app: an OpenAI-compatible server (chat with tool calls,
embeddings, routing decisions) driven by per-domain regex scripts. Playwright starts it as a `webServer` and points the
app at it (`mockLlmEnv`), so every AI E2E test runs without internet, in CI and in the verification sandbox.

### 4 · Acceptance criteria → tests, and component guides

- `acceptance.yaml` in a recipe or native component maps criteria (all regexes must match) to tests. The assembler
  writes `ACCEPTANCE.md` and `.turbineh/acceptance.json`; after verification a covered criterion becomes `met` only if
  the whole gate passed; criteria nothing proves stay `open`. `acceptanceSection()` returns the markdown block for the
  `AGENTS.md` generator.
- `guide.yaml` (`turbineh.guide/v0.1`): what it does, use cases, use when / avoid when, trade-offs, config, interfaces,
  extension points (`what/where/how`, same shape as recipe guides), compatibility, security, guarantees linked to
  shipped tests (checked by `pnpm catalog:validate`), limits, a minimal example, keywords and synonyms. The decider
  card includes use-when/avoid-when/keywords; apps get `docs/components/<id>.md`.

### 5 · Enforcement

`turbineh.ai-direct-model-call` also matches hand-written clients such as ``fetch(`${BASE}/chat/completions`)``;
remediation rewrites tool loops to `runAgent()` and custom `LLM_*` variables to `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`.
The orchestrator's own transport, `agent.ts` and the test mock are not flagged.

## Consequences

- A coding agent receiving a booking-assistant package has the domain, the assistant, the staff pages, the mock and
  the E2E suite already green, and sees what is left in `ACCEPTANCE.md`.
- New domains follow the same contract; the runtime, mock and acceptance mechanism need no change.
- Limits: per-turn runtime (no streaming, no long-running autonomy); bookings are one business per app with start
  times on a grid; confirmation words cover en/es/fr/de/pt (buttons work in any language).

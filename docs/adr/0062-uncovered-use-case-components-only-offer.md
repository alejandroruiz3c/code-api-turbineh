# ADR-0062 · Uncovered use case: explain it well, and offer only the verified components that really serve it

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-16
- Amends: ADR-0052 §2 ("Uncovered → nothing is generated") — the use case is still never generated; what changes is
  the explanation and a components-only offer
- Context: owner requests, verbatim: "cuando alguien pide algo que no cubren los casos de uso informarle bien y asegurar
  que si aunque el caso de uso no cumple pero hay algún componente que le sirve sí se lo preparamos." and, while this
  was built: "importante que siempre la info proveída sea real. que no ofrezca nada por ofrecer. tiene que ser real que
  aporta al enfoque funcional que busca. lo más crítico es asegurar que la intención funcional que pide es lo que
  damos."

## Decision

### 1 · One explanation, everywhere

An uncovered request carries a `NotCoveredExplanation` (`packages/shared`): `title` ("The library doesn't cover this
use case yet"), `useCase` (the request's headline, in the person's words), `notCovered[]` (each requirement and why, in
plain words, from the scope gate), `priority` (the demand is recorded and the person is notified with priority —
ADR-0052 §4, ADR-0056) and `canDoNow` (the offer below, or how to continue within what is covered), plus `offer`.
The worker stores it with the flow (`metrics.explanation`, or `plan.scope.explanation`); `explainFailure` returns it in
`problem.explanation` / `errors[].explanation` (rebuilt from `metrics.scopeGate` for older rows). The web
(`NotCovered` component on the plan, the wizard and a refused flow), the API, the CLI (`explanationLines`) and MCP show
the same content.

### 2 · Offer only what is real (owner rule: precision over recall)

`packages/engine/src/component-offer.ts`. A component is offered for a requirement only when every check passes:

1. **Explicit ask (code).** A functional capability hint (`OFFER_HINTS`) matches both the requirement and the person's
   own request. Plumbing the request only implies (sign-in behind an admin area, a database, forms) is never offered —
   a compiled criterion "users sign in" in a request that never asked for it brings nothing.
2. **Servable (code).** The requirement is not left out by the gate for something no component can change: an external
   platform, autonomous actions, a native app or hardware, or the use case itself. A requirement left out only because
   no AI was chosen can be served by the AI orchestrator, and by nothing else.
3. **Evidence (code).** A verified test of the component proves that function: an acceptance rule of the component that
   matches the requirement, else a tested guarantee (guide.yaml) or acceptance test of that function. The test is
   recorded per mapped requirement (`OfferedComponent.proof`) and shown on every surface and in the package docs.
4. **Judgement.** The resource decision engine confirms each (requirement, component) pair in one batched request
   (`Decider.componentsServe`, new decision point; questions and threshold in the private engine, ADR-0058). It can
   only narrow the code's candidates, never add. Without an answer (open engine, older engine, outage), code decides
   only where nothing of the request is blocked and the use case itself is not in question; otherwise nothing is
   offered ("when in doubt, don't offer").

Declared dependencies (`relations.requires`, e.g. the AI Safety Pack) come with the component they belong to.

### 3 · Say plainly what the person gets

`ComponentOffer`: `title` ("Verified components for your <need>: <ids>"), `youGet` ("You get <functions> — working and
verified, as separate components to add to your app."), `notIncluded` (when the use case itself is not covered:
"Not included — the core of your request: <use case> itself, and … This package is not that product."),
`coreNotIncluded`, `components[]` (`does`, `gives`, `serves`, `proof`), `outOfScope[]` and `approve` (how to accept it on
the web, the API, the CLI and MCP).

### 4 · Approve with one action, build through the existing components path

- Plans (`POST /v1/plans`, the web, `turbineh build`/`plan`, MCP `build`): the answer is a plan with
  `scope.status: "components_only"`, `scope.explanation`, top-level `offer`, the components as a component plan
  (`capability.kind: "component"`) and, first in `needsApproval`, `Build verified components only, "<name>": …` (never a
  gap notice, never auto-approved). Accepting it: the web button "Build the verified components", `POST
/v1/plans/{id}/generate {"approve": true}`, `turbineh resume <id> --approve` (`turbineh build` stops with exit 3 and
  `error.code: "components_only_offer"`, `data.offer`), MCP `resume {id, approve: true}`.
- Direct builds (`POST /v1/builds`): refused with `use_case_not_covered` + the explanation and its offer unless
  `components_only: true` is sent; then the worker packages the offer at once.
- Generation is the component path of ADR-0051: exactly those components, their contract tests in the sandbox, the
  honest state, ZIP or pull request. The badge says what it is: `Checks X/Y · Requirements 0/N met · components only: K
served by a component, M out of scope`; the package README and `agent/INTEGRATE.md` carry a "Scope: verified
  components only" section (what you get, what is not included, component → requirement → proving test).
- With nothing to offer, the refusal stands (422 `use_case_not_covered`, exit 5) with the explanation and the flow `id`
  (plus `status_url`/`events_url`), so an agent can reference the refused request.

### 5 · Unchanged

Partially covered requests (ADR-0052 §3), explicit components (§5), the demand record and emails (§4, ADR-0056): a
flow with an offer is still recorded as uncovered demand.

## Measurement

`bench/offers/labelled.json`: 18 labelled requests (8 where nothing may be offered, 10 with an acceptable function),
run by `apps/worker/src/offer-bench.ts` (`--engine` for the installed engine with real backends; results in
`bench/offers/results/`). On 2026-10-16: the private engine (JEV) offered 4 components, all correct (precision 1.000;
shop payments, invoice PDFs, ticket QR codes, a waitlist); code alone offered 2, both correct; the deterministic checks
with a judge that approves everything reach 0.9 (the one miss — a scheduler for "Bluetooth lights on a weekly
schedule" — is exactly what the judgement removes, and code alone offers nothing there because hardware is blocked).
Recall is deliberately low: the AI orchestrator for "AI drafts" / "AI captions" and a weekly CSV export were not
confirmed by the engine, and `auth.session.better-auth` has no tested sign-in guarantee in its guide, so it is never
offered until one is added.

### 6 · The scope question sees the whole catalogue

The private engine's scope question showed only the first 60 catalogue components, so requirements served by a later
component (Stripe payments, PDF, QR codes…) were judged "outside the library". Since resource-decider 1.1.1 the worker
sends the whole approved catalogue with each component's capabilities and guide keywords/aliases
(`ScopeInput.catalog`), and the engine ranks it per requirement and keeps the most relevant ones within its state
budget. Code checks never use keywords (a keyword never makes a platform "connected"). Re-run of the labelled set with
1.1.1 (JEV): 4 offered, 4 correct (precision 1.000); the owner's example is still refused with the explanation.

## Consequences

- One more batched decision request for uncovered requests that have candidates.
- A catalogue component without a tested guarantee of its function is never offered: documenting guarantees
  (`pnpm catalog:document`) now also widens what can be offered.
- Tests: `packages/engine/src/component-offer.test.ts`, `apps/worker/src/scope.test.ts`,
  `apps/worker/src/offer-precision.test.ts`, `apps/web/src/app/v1/plans/route.test.ts`,
  `apps/web/src/components/scope-gate.test.tsx`; private engine `test/serve.test.ts`.

# ADR-0046 · Criteria aliases from component params

- Status: accepted (owner-approved proposal of ADR-0045; number may need renumbering at merge)
- Date: 2026-10-13
- Context: ADR-0045 raised recall by renaming tests, but a domain component's tests are generic: the booking
  assistant serves "a customer" of "the business" and books "a staff member", while the request says "a **patient**
  of the **clinic** books a **physiotherapist**". `proofVerdict` (precision first, ADR-0039) rightly refused those
  criteria. The app already knows the mapping: the component's params, written from the request
  (`src/bookings/params.json`: `customer.singular = "patient"`, `resource.singular = "Physiotherapist"`).

## Decision

1. **Declared, not guessed.** A component may ship `aliases.yaml`: its params file, the test files it applies to,
   and for each generic word the params path that holds this app's word:
   - `domain.bookings.turbineh`: customer(s) → `customer.singular/plural`, staff member(s) → `resource.*`, business →
     `business` and `businessKind`, service → `services[].name` (fact);
   - `domain.workflow.turbineh`: record(s) → `workflows[].label/plural`, status/state → `workflows[].stateNoun`, states
     → `workflows[].states[].label` (fact).
     New params written by code from the request: `businessKind` ("a physiotherapy clinic" → "clinic") and `stateNoun`
     (the workflow pattern's field, e.g. "stage").
2. **Resolved per app.** The assembler resolves the declarations against the params the app ships, writes
   `.turbineh/aliases.json`, and attaches the aliases to the proofs of that component's tests only (also when the guide
   re-checks proofs at verification).
3. **What an alias may do in `proofVerdict`:**
   - a word alias applies only when the test itself uses the component's word;
   - a **fact** alias (service names, prices, states) applies only when one of the test's assertions matches the
     declared pattern, i.e. the test asserts the values it reads from params (the booking test now asserts each service
     with its price from `params.services`);
   - alias words never carry a refusal: the refusal check reads the test's own text only, and negation words are
     dropped from aliases;
   - the actor check is unchanged: the actor must still be named, by the test or by a declared alias of the word it
     uses; nothing else is equated (a "therapist" is not a "physiotherapist").
4. Booking-assistant titles use the component's words ("a customer requests to reschedule…").

## Measurements

- 109 labelled pairs: precision **1.00**, recall 0.92 (unchanged; with the Flex Physio aliases applied to the agent
  pairs, still 1.00 / 0.92 — no new false "met").
- Frontiers ai-agents + domain.bookings spec (14 criteria): 1/14 → **5/14** (reschedule, cancel inside the notice
  period, pricing from params, confirmation email, input limit).
- Kilnwise: 1/6 → 1/6. The aliases resolve "piece" and "stage", but the open criteria name facts the workflow tests
  do not assert (append-only event with the piece code, previous stage and timestamp; a highlighted Kanban card; the
  piece's metadata fields) or a "staff" actor.

## Still open (honest limits)

- "Clinic address" and "what to bring": the request gave no value (params `faq[].answer = null`), so no test can
  assert it.
- "therapist" vs "physiotherapist", opening hours as weekday names, rate-limit throttling, the staff dashboard, prompt
  injection "persona", and the LLM mock are not proven by any shipped test.

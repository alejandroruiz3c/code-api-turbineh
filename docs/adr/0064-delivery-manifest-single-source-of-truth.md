# ADR-0064 · Delivery manifest: one source of truth, relevance and recipe tree-shaking

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-16
- Context: external audit v2 (16/10/2026), findings F-03 (critical), F-11, F-05 and the Annex A observation. In the
  flows audited, the plan approved `ops.idempotency` as "written and verified as glue" and the result's "Next steps"
  said it was not included; `ai.orchestrator` and `security.ai-safety` were used without a traced decision while
  `ui.table`, `ui.form`, `ops.rate-limit` and `payments.checkout.stripe` were decided and never used; "Next steps" said
  payments were not included while `billing.ts` was delivered; one criterion disappeared between the plan and the
  result; the UI listed 12 settings as "needs your configuration", DEPLOY.md 4 required ones and the plan 23 (without
  `BETTER_AUTH_*`). The plan "fit 100%" measured how well a component fits a capability, not whether the request asked
  for it: 39 capabilities including YAML, image processing, text chunking and payments for a social-media publisher.
  A bookings app shipped a CMS route (`src/app/[collection]/[slug]/page.tsx`) and an AI app a public `/assistant` LLM
  route nobody asked for. Owner principle: the functional intent requested is what we deliver; every piece of
  information shown is real; nothing is offered or claimed for its own sake.

## Decision

1. **Delivery manifest** (`packages/shared/src/delivery.ts`, schema `turbineh.delivery/v1`). Built by the pipeline
   from its real selection and resolution (`apps/worker/src/manifest.ts`): one entry per capability of the build with
   how it is delivered — a verified `component`, the use case's template (`recipe`), `written` by TurbineH (only when
   the Backup Coder policy really allows it: `backupMayFill` and a T1/T2 trigger), or `not_included` with the reason —
   and what justifies it (`justifiedBy`: a criterion, a requirement stated in the request, a transversal requirement,
   the covered use case, or another component that needs it). It also carries the criteria (in order), the settings
   (single env schema), what was left out as not asked for (`notSelected`), the broken promises and the footprint.
   Every surface is rendered from it: the plan (`Plan.delivery`, decisions with `way` and `justifiedBy`, components,
   settings, what is not included), the live decisions panel, the result (settings and what is left from the
   reconciled manifest), "Next steps" (the manifest's steps are fixed words, never rephrased by the writer model),
   DEPLOY.md, AGENTS.md, turbineh.json (`delivery`, `gaps`, `brokenPromises`), `.turbineh/delivery.json`, the web UI and
   the CLI.
2. **Promises bind.** A plan's manifest is approved with the plan; generation reuses its justifications (no second
   decision) and `finalize` reconciles it with what the package really contains. An approved entry that is not in the
   package is a **broken promise**: the package is still delivered, but `delivered, not verified: N approved
decision(s) not kept`, with the failure, in every surface. Plans never promise what TurbineH does not do: a gap the
   Backup Coder may not fill (e.g. `ops.idempotency`, which needs persistence) is `not_included` with why and needs
   the person's approval ("Not included in this build: …") instead of "TurbineH writes it". Improvements reconcile
   the parent's manifest again.
3. **Consistency check.** `checkConsistency` compares each surface, read back from what was written, with the
   manifest (components used vs decided, criteria list, open criteria, required and optional settings, included and
   not included capabilities, broken promises, "verified"): any two surfaces that disagree make one of them disagree
   with the manifest. The worker records it with every flow (`metrics.consistency`, logged when not empty); CI
   (`apps/worker/src/delivery-consistency.test.ts`) plans, assembles and finalises every recipe with the real
   renderers (only the sandbox gate is replaced) and requires 0 contradictions, plus the idempotency regression.
   Since the audit's validation dry run found the result's "what is left" contradicting turbineh.json, `outcome.left`
   and `needs` of a generated flow come from the delivered acceptance result and manifest, never from the plan's
   prediction (`deliveredLeft`, `flowNeeds`), also for flows recorded before this change.
4. **Relevance.** Only capabilities justified by a requirement of the request or a declared transversal requirement
   reach selection (`apps/worker/src/relevance.ts`): transversal requirements are declared by the recipe chain
   (`recipe.yaml` `transversal`: auth, security, persistence, interface); the covered use case justifies what its
   template implements and the components its code needs; domain components are justified by the request sentences
   that selected them; non-functional requirements by their text; everything else asks the decision engine's new
   optional `capabilityRelevance` (private `resource-decider` 1.2.0: one Choice per capability over the criteria and
   stated requirements, threshold in the private engine) and falls back to the open rules (`openRelevance`: shared word
   stems with the capability's plain name). The rest is listed as "left out, not asked for" on the plan, the live
   panel and the CLI. `ui.table`, `ui.form` and `ops.rate-limit` are implemented by the saas-crud template itself
   (`providedCapabilities`), so no library is decided for them. Plan decisions now include the components chosen by
   code (`ai.orchestrator`, `security.ai-safety`, domain components) with their justification.
5. **Recipe tree-shaking.** Templates and components declare optional modules (`recipe.yaml` / `component.yaml`
   `modules`: files, settings, navigation, marked blocks `turbineh:module <id>` … `turbineh:end-module <id>` and their
   `without-module` replacements). A module ships only when its capability is justified (or its condition holds: the
   orchestrator's public assistant only with a public domain toolkit); its files, blocks, settings and navigation are
   removed otherwise. The `site.public-pages` pattern no longer fires on a bookings app's public booking page (an
   entity gets public pages only when a sentence asks for pages of it, outside a corporate site). **Footprint**
   (`footprintOf`): share of the app's source lines no criterion or transversal requirement links to, by file owner;
   recorded in the manifest with the removed modules.
6. **Settings (F-11).** One env schema (`appSettings`): `src/env.ts` (Zod; a setting required by a refinement is
   required) plus the settings the app's `.env.example` declares (a description starting with "Required" makes it
   required: e.g. the staff list of a booking calendar). The plan, the result ("Settings": Required / Optional),
   DEPLOY.md, AGENTS.md, turbineh.json and the CLI show the same split, `BETTER_AUTH_*` included. The AI connection
   settings are two equal options (gateway or own provider, F-09): optional in the schema and presented in DEPLOY.md's
   own AI section, which the consistency check reads too.

## Consequences

- The plan is longer by the decisions the code always took (they were hidden) and shorter by everything not asked
  for. A flow whose approved promise is not kept is never "verified", even with every check green.
- `@turbineh/decider` gains an optional method; engines without it keep working with the open rules. The pinned
  private engine must vendor the new contract before deploy (`infra/private/versions.json`).
- Measured on staging with real requests (see the PR): contradictions between surfaces and footprint per flow.

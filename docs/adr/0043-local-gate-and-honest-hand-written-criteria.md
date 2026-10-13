# ADR-0043 · Local gate (`turbineh verify --full`) and honest hand-written acceptance rules

- Status: accepted (number may need renumbering at merge if another branch takes 0043)
- Date: 2026-10-13
- Context: learning round of 2026-10-13, the two items ADR-0040 left open. **G4c**: agents handed over packages that
  the gate then failed on security and policy findings they could not see locally (unauthorised server actions, a
  secret-shaped placeholder in `src/env.ts`). **G3**: hand-written `acceptance.yaml` rules matched criteria by their
  `covers` regexes alone; in the bookings package "the owner books a slot and sees it in the calendar" was cited as the
  proof of seven unrelated criteria, and agents trusted those false "met".

## Decision

### G4c · `turbineh verify --full`

1. `localGate()` in `@turbineh/verifier` runs the gate's security and policy checks with the gate's pinned versions:
   - gitleaks 8.30.1 (`ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0…`, `--network none`, read-only mount,
     `--redact --report-format json --report-path -`) on the git history (as the gate) **and** on the files the next
     commit would add (tracked + untracked, not ignored, copied to a temporary folder). Only rule, file, line and
     commit are read from the report; values are never read or printed;
   - Semgrep 1.178.0 (the gate's pinned image) with the TurbineH rules; the CLI bundle embeds `turbineh-security.yml`
     (esbuild `define`), so the rules are exactly the gate's; same exclusions (`semgrepScanArgs` shared with the gate);
   - OSV with package name@version only (the gate's `osvScan`, now exported);
   - the licence policy, in process: installed `package.json` files under `node_modules/.pnpm`, the gate's regex and
     SPDX semantics (`licenseBlocks`);
   - early and tool-free: secret-shaped literals in `src/env.ts` (the G4b pattern). A literal the gate's
     `turbineh.hardcoded-secret` rule matches blocks; defaults, fallbacks and URLs with a password are reported as
     non-blocking `turbineh.env-secret-literal`. The default `turbineh verify` runs this check too.
2. **Docker first.** Without Docker: a local `gitleaks`/`semgrep` binary is used only when its version is exactly the
   pinned one. Otherwise the check is reported as **not run** (with how to make it run) and the command fails: a check
   that did not run never counts as clean. `--offline` skips OSV (also reported as not run). No code leaves the
   machine.
3. Output: each finding with file:line (or package), the rule, a security / policy / quality label and the fix. The
   fix text lives in `fixes.ts` and is also added to the gate's own findings (`GateFinding.fix`), so `--json` has
   exactly the gate findings' shape. The project's typecheck, lint and unit tests run too (quality findings) unless
   `--skip-scripts`. Exit 1 on a blocking finding or a check not run.
4. AGENTS.md "Before handing over" is `turbineh verify --full && pnpm build && pnpm test:e2e`; the agent block, the
   Claude Code skill, the MCP `verify` tool (`full: true`) and the /use page document it.

### G3 · Hand-written rules go through `proofVerdict`

1. Every rule carries its proof: the title and key assertions of the test it names, **read from the test file** — the
   assembled package at assembly, the catalog sources (recipe chain templates, component `files/` and `files-ai/`) at
   plan time. A rule whose test does not exist there is dropped. `covers` only pre-selects; a rule matches only when
   `proofVerdict` accepts its proof. No proof, no match.
2. At verification (`verifiedGuide`) the rule's test is re-read as shipped and must still exist and pass
   `proofVerdict`: an agent that deletes or rewrites the proving test loses the "met".
3. `proofVerdict` ignores Given/When/Then mechanics (click, button, browse, proceed, area, database, redirect,
   authenticated…), folds a few synonyms (change/adjust/increase → edit; reject/deny/prevent → refuse; purchase → order;
   paid → pay; subtotal → total; double-booking/conflict → overlap…) and stems "-ments"/"-ings" in two passes. Actor and
   refusal checks are unchanged.
4. One rule that was not a test (`tests/mock-llm …` in `ai.orchestrator.turbineh`) is removed.

## Measurements (`packages/shared/src/criterion-proof.test.ts`)

- New labelled set `RULE_PAIRS`: 71 pairs (criterion, test a hand-written rule cited, test as shipped) from the
  learning-round packages and the bookings template, including the seven bookings false "met". Precision 1.00 (0 false
  "met"), recall 0.48 (16/33). With the existing 38 `PROOF_PAIRS`: 109 pairs, precision 1.00, recall 0.63.
- Re-evaluating the 14 learning-round packages' criteria with the catalog's rules: 86 of 139 criteria matched by
  `covers` alone before; 16 are proven now (15 with the tests as the agents delivered them). The bookings package goes
  from 8 to 0.

## Consequences

- An agent sees the gate's security and policy findings, with the fix, before handing over; the bookings run copy
  reproduces the gate's three blocking findings locally (`src/env.ts:21`, `src/app/actions.ts:28`, `:50`).
- Fewer criteria show as met; the open ones are listed with where to implement them. Recall is the cost of precision:
  a test title that does not name what a criterion checks (e.g. "filter", the "product" whose stock is decremented,
  the "shopper" actor) leaves it open. Better test titles in recipes raise it without loosening the matcher.
- The report's decider mapping (ADR-0039) is unchanged.

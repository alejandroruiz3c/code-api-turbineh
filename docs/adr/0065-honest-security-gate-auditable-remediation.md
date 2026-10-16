# ADR-0065 · Honest security gate: re-scanned fixes, blocking XSS, auditable corrections, pass with warnings, safe job runs, PII redacted by default

- Status: accepted
- Date: 2026-10-16
- Context: technical audit v2 (16/10/2026) of YES IF for Builders, findings N-02, F-07, F-08, F-10 and F-12.
  - **N-02** (high): in flow 52eff6c8 (bookings) SECURITY.md listed the same finding twice under "Fixed automatically"
    (`dangerouslySetInnerHTML` in `src/app/[collection]/[slug]/page.tsx:60`, rule `turbineh.unsanitized-html`) and
    again under "Remaining alerts"; the UI showed "2 Security issues fixed before delivery" with the static check
    green. Cause: the fixed list was the fixer's claims (`RemediationChange[]`, one per round), never compared with
    the re-scan; the XSS rule is a WARNING, so it never blocked. Root cause of the finding itself: Semgrep reports
    that match at the line of the JSX conditional (60), one line above the component's `// nosemgrep` (61), so the
    suppression of a safe JSON-LD script did not apply.
  - **F-07**: the result showed 11/11 without saying what failed on the first pass or what was changed.
  - **F-08**: the dependencies check was a plain green while a high development-only advisory (braces@3.0.3, no
    patched version) was open.
  - **F-12**: Vercel Cron calls `/api/jobs/run` every minute; overlapping calls and retries could repeat side effects.
  - **F-10**: `AI_REDACT_PII` defaulted to false.

## Decision

### Security ledger: fixed means gone from a new scan (`@turbineh/remediation` `ledger.ts`)

- Findings are identified by rule + file + line (code) or advisory + package@version (dependency), deduplicated.
- Every remediation round is followed by the full gate (as before) and **settled** by it (`settleRound`): a finding
  counts as fixed only when a fix was attempted for it in that round and the new scan no longer finds it. Lines move
  when a file is edited, so code findings are compared per rule and file: a file that keeps as many findings of a
  rule as before fixed none of them. A static scan that did not run (`findings.staticScanned: false`, new) proves
  nothing.
- After the repairs, the candidates are **reconciled** with the final scan (`reconcileFixes`): a finding still present,
  or a rule and file that did not lose findings between the first and the final scan, is never "fixed". Nothing is
  both fixed and remaining. Attempts that did not work are listed under "Attempted, not fixed".
- `fixedBeforeDelivery` (START_HERE, report, UI, activity summary) is that verified count. The fixer's changes are
  kept as `remediationAttempted` in the metrics. Flows recorded before this change only have the fixer's claims: the
  flow page shows "—" for them and the workspace total counts only re-scanned flows.

### XSS and open redirects in exposed routes always block (`@turbineh/verifier`)

`gateSeverity()` raises `turbineh.unsanitized-html` and `turbineh.open-redirect` to ERROR when the file is in
`src/app`, `src/pages` or `src/components` (not tests): the gate's and `turbineh verify --full`'s findings are blocking,
with "reachable by visitors" in the message. Remediation then must fix them and the re-scan must confirm it, or the
build is not verified. The Semgrep rules keep WARNING for server-only helpers and scripts. The public-pages component's
JSON-LD suppression now sits on the line Semgrep reports; the whole catalogue (recipe templates and component files)
scans with zero findings.

### Auditable corrections (F-07)

- `RemediationAudit` (finalize → metrics `audit`, report facts): the status of every check on the first pass
  (pass / pass with warnings / fail) and its blocking findings; every correction — directed corrections, Backup Coder
  T4, swaps, security fixes, repairs — with its commit in the delivered repository, files, what it addressed and its
  diff (first 150 lines; `git show <commit>` for the rest); refused changes; fixed and not-fixed findings.
- TURBINEH_REPORT.md gets "How this build was corrected" (written by code, never by the writer model; the diff fence is
  longer than any backtick run so it is shown exactly). SECURITY.md lists verified fixes with round and commit,
  "Attempted, not fixed" and "Refused changes". The flow page's Check tab shows the same ("How this build was
  corrected", diffs in collapsible blocks).
- **Repairs never move the goalposts** (extends ADR-0054 `revertWeakenedTests`): `revertForbiddenChanges` also reverts
  any added suppression (`nosemgrep`, `eslint-disable…`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`,
  `gitleaks:allow`) and any edit of a check's configuration (`eslint.config.*`, `.eslintrc*`, `tsconfig*.json`,
  `vitest.config.*`, `playwright.config.*`, `.semgrepignore`, `.gitleaks*`; new ones are removed). It runs in the
  directed corrector, the Backup Coder T4 patch, the security fixer (which refuses before writing) and the repairs
  after a security fix; every refusal is reported with its reason. The fixer and corrector prompts say so too.

### Pass with warnings (F-08)

`StepResult.warnings` (and `CheckResult.warnings`): a passing `static` step with WARNING findings, or a passing
`dependencies` step with non-blocking advisories, is "pass with warnings" (`checkStatus()` → `warn`). It is shown as
such in SECURITY.md's table, START_HERE.html ("N/N checks passed · K with warnings", amber), AGENTS.md's gate line,
the badge ("Checks 11/11 (1 with warnings) · Requirements 2/5 met") and the API (`outcome.checks.warnings`).
Non-blocking advisories are listed in the package's SECURITY.md as **accepted exceptions** with the reason
(development-only, or below high), the OSV patched version (none, or "unknown" when the lookup failed — never a guess)
and a review date (scan + 30 days, `EXCEPTION_REVIEW_DAYS`). The policy is documented in the repository's SECURITY.md
("Exceptions policy").

### Job runs that cannot duplicate side effects (F-12, `jobs.queue.turbineh`)

- The queue already claims with `FOR UPDATE SKIP LOCKED` under a lease with a fencing token (ADR-0055): that lease is
  the distributed lock — two runners never hold the same job. No session advisory lock is added: with pooled
  serverless connections a session lock can outlive or miss its holder; the row lease cannot.
- `enqueue(…, { idempotencyKey })`: unique `(organization_id, type, idempotency_key)`; repeated enqueues return the
  existing job.
- `ctx.once(key, fn)`: the effect is recorded in `job_effects (job_id, key)` before it runs; a retry, an overlapping run
  or a runner that lost its lease skips it; if `fn` throws the record is removed so a retry may run it. At most once:
  a crash in the middle is not retried. `ctx.idempotencyKey(key)` (`<jobId>:<key>`) for providers' `Idempotency-Key`.
- `tests/unit/jobs-concurrency.test.ts` runs the real Postgres store (the app's schema through drizzle-kit) on PGlite:
  two runners at the same time on 30 jobs (each runs once), five concurrent enqueues with one key (one job), and a
  runner whose lease expires while the next cron call takes over (the effect is sent once).
- `jobs.scheduled.turbineh` was already idempotent per (job, scheduled instant). The rate limiter is the Security Pack's
  PostgreSQL store in every recipe (all extend `saas-crud`; no component ships another limiter; the in-process store
  is only for tests and `RATE_LIMIT_STORE=memory`).

### PII redacted by default (F-10)

`AI_REDACT_PII` defaults to `true` in the AI Safety Pack: emails, phone numbers, IBANs and card numbers are replaced
before they reach a model and in its answers. The opt-out is explicit (`AI_REDACT_PII=false`), documented in
`.env.example` (with a reminder to record why, GDPR art. 25 and 30) and in the guides; tests cover both.

## Consequences

- Builds with an XSS in a route no longer deliver as verified unless the fix is confirmed by a scan; fixers that
  "fix" by silencing a rule are refused, so some builds that were green may now fail and say why.
- The security count shown can only go down compared with before; for older flows it is not shown.
- Corrections that relied on `eslint-disable` or `@ts-expect-error` are refused; the code has to be fixed instead.
- Agents that need a person's email in AI tool results must set `AI_REDACT_PII=false` explicitly.
- `ctx.once` is at-most-once by design: an effect interrupted by a crash needs a person or a provider-side
  idempotency key to be completed.

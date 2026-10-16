# Security policy

## Reporting a vulnerability

Email **alex.ruiz@turbineh.com** with details and reproduction steps. Do not open a public issue.

## Platform guarantees (design)

- Secrets never enter git: `.env.local` is ignored, gitleaks runs in pre-commit and on the full history in CI.
  Any leaked key is rotated immediately.
- Third-party code is installed, built and tested only in ephemeral sandboxes without real secrets.
- Every generated app receives the Security Pack; there is no flag to disable it.
- Security reports always state scope, tools, date, findings and what was **not** checked — never a binary "secure".

## Generated apps: what the security gate counts and what it accepts (ADR-0065)

- **Fixed means re-scanned.** After every automatic fix the whole gate runs again. A finding (rule + file + line, or
  advisory + package) counts as "fixed automatically" only when the new scan and the final scan no longer find it;
  attempts that did not work are listed as "Attempted, not fixed". A finding is never both fixed and remaining, and
  the number shown in the product is that verified count.
- **XSS and open redirects in exposed routes always block.** In routes, pages, layouts and components
  (`src/app`, `src/pages`, `src/components`) the gate raises `turbineh.unsanitized-html` and `turbineh.open-redirect`
  to blocking: the build is fixed and re-scanned, or it is not verified.
- **Repairs never move the goalposts.** An automatic correction may not weaken a test, add a suppression
  (`nosemgrep`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `gitleaks:allow`) or edit a check's
  configuration (ESLint, TypeScript, Vitest, Playwright, Semgrep/gitleaks ignore files). Such changes are reverted
  and listed as "Refused changes" in the package's SECURITY.md and TURBINEH_REPORT.md, next to the checks that
  failed on the first pass and the diff of every correction.
- **Pass with warnings.** A check that passes with non-blocking findings left is shown as "pass with warnings" (in
  SECURITY.md, START_HERE.html, the badge and the API), never as a plain pass.

### Exceptions policy

Only these advisories are delivered without blocking, as **accepted exceptions**:

| Exception                                                                                                                                       | Why it does not block                                  | Review                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------- |
| High or critical advisory in a **development-only** dependency (build and test tools, not in the production dependency closure of the lockfile) | Not shipped to users and not reachable at runtime      | 30 days after the scan |
| Low or moderate advisory in a shipped dependency                                                                                                | Below the blocking threshold (high and critical block) | 30 days after the scan |

Each exception is listed in the package's SECURITY.md ("Accepted exceptions") with the advisory, the package and
version, the reason, whether OSV publishes a patched version (or that the lookup failed) and the review date. A
patched version, when one exists, is applied by "Improve & redeliver". High or critical advisories in production
dependencies are never an exception: they block delivery. This policy itself is reviewed on 2027-01-16.

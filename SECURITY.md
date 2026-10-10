# Security policy

## Reporting a vulnerability

Email **alex.ruiz@turbineh.com** with details and reproduction steps. Do not open a public issue.

## Platform guarantees (design)

- Secrets never enter git: `.env.local` is ignored, gitleaks runs in pre-commit and on the full history in CI.
  Any leaked key is rotated immediately.
- Third-party code is installed, built and tested only in ephemeral sandboxes without real secrets.
- Every generated app receives the Security Pack; there is no flag to disable it.
- Security reports always state scope, tools, date, findings and what was **not** checked — never a binary "secure".

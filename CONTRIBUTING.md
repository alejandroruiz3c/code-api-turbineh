# Contributing

- One branch and one PR per work package: `wp/<n>-<slug>`. Conventional Commits.
- Definition of Done: code + tests + green CI + updated docs + ADR if a decision was made + `CHANGELOG.md` entry.
- Exact dependency versions only, stable and published more than 14 days ago ([ADR-0002](docs/adr/0002-stack.md)).
- Secrets live only in `.env.local`. The pre-commit hook runs gitleaks; CI scans the full history.
- Model access always goes through `packages/decider`, `packages/compiler` or `packages/backup-coder`.
- Version compatibility, licences, permissions and test results are decided by code, never by a model.
- Never install, build or test third-party code outside the ephemeral sandbox.
- Public documentation is written in English. No metric may appear in docs or UI unless it comes from `bench/`.

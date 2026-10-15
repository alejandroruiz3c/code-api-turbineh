# Catalog gaps (Backup Coder flywheel)

Every time the Backup Coder fills a capability that has no approved component (triggers T1/T2, PLAN §2.4), the
worker writes one JSON record: capability, trigger, model, tokens and the generated code. Recurring gaps become
candidate components for the curation pipeline (`pnpm catalog:curate`), so the Backup Coder is needed less over time.

- Local runs write here (`*.json` is git-ignored: they are test runs).
- Staging/production workers write to `GAPS_DIR` (outside the deployed tree) and the same data is stored in each
  build's metrics (`metrics.backup.activations`).

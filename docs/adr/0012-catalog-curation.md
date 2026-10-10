# ADR-0012 · Catalog curation, certification and selection policy

- Status: accepted
- Date: 2026-10-10
- Context: PLAN §3 (catalog), §3.6 (licences); evaluation document (common contracts per capability)

## Curation pipeline (`pnpm catalog:curate catalog/curation/<batch>.yaml`)

1. **Evaluate** (no code executed): highest stable version older than 14 days (optional pinned major line), licence
   and integrity from the registry (origin `maintainer`), advisories with real severity from OSV (origin `tested`).
   Manifest written with `status: evaluated`.
2. **Certify:** every component ships a `contract.test.ts` next to its manifest that exercises its documented API
   deterministically (no network, no external effects). All packages of a batch are installed in one sandbox
   workspace (the only networked step, no secrets); contracts run with `--network none`.
3. **Approve:** only if the contract passed **and** the deterministic approval gate passes (allowed licence with
   declared = detected, no unmitigated high/critical advisory, tested evidence). Evidence:
   `bench/results/<date>-certify-<batch>.json`.

Licences outside the allow-list stay `evaluated` forever (first cases: `busboy` — no declared licence; `nodemailer`
— MIT-0).

## Selection policy (code)

- Capabilities are decided by the decider with one atomic Noul each; threshold **0.6** (calibration v1 from build
  traces; recalibrate with the D2 benchmark).
- Recipe default capabilities are added by code.
- Among eligible candidates, **components the recipe already integrates come first** (vendored or present in the
  recipe's verified lockfile); the decider's order is kept within each group.
- Selected external libraries that the recipe cannot integrate yet are reported as _integration pending_ and are
  never claimed as used. Integration (install into the lockfile + glue) is WP10.

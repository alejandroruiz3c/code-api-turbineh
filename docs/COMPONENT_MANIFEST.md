# Component manifest `turbineh.component/v0.1`

Schema: [`packages/catalog/src/component.schema.json`](../packages/catalog/src/component.schema.json) (JSON Schema 2020-12).
Reference example and field meaning: [PLAN §3.3](PLAN.md). Validate with `pnpm catalog:validate`.

## Rules enforced by the validator

- Schema-valid, no unknown fields; `id` = `category.capability.implementation`, prefix equal to `category`;
  directory name equal to `id`.
- `status: approved` additionally requires: contract tests passed, a security scan date, no unmitigated
  critical/high finding, declared licence = detected licence, licence in the beta allow-list
  (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC) and at least one evidence entry with `origin: tested`.

Every claim in `evidence` states its origin: `maintainer`, `model-inferred`, `tested` or `unknown`.

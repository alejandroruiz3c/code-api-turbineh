# Architecture

See [PLAN §2](PLAN.md) for the full design and [ADR-0001](adr/0001-architecture.md) for the core decision.

| Module             | Package                                 | Decides                                                                               | Model                                                      |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Decider            | `packages/decider`                      | Recipe, capabilities, abuse guard, component fit, criteria ↔ evidence, finding triage | JEV (batched atomic questions); open fallback              |
| Intent compiler    | `packages/compiler`                     | `BuildSpec` in small validated parts                                                  | Small open model                                           |
| Selector           | `packages/selector`                     | One batched decider request per build                                                 | —                                                          |
| Resolver           | `packages/resolver`                     | Versions, licences, peers, conflicts                                                  | Deterministic                                              |
| Assembler          | `packages/assembler`                    | Recipe templates, entity code, native components, docs                                | Deterministic                                              |
| Integrator         | `packages/integrator`                   | External components, glue, gaps, corrections, swaps                                   | Compiler model (glue, patches); Backup Coder (T1/T2/T4/T5) |
| Verifier           | `packages/verifier`                     | Pass/fail of every check                                                              | Deterministic (sandbox)                                    |
| Remediation        | `packages/remediation`                  | Security fixes before delivery, improvement estimate                                  | Open security specialist (Backup Coder slots)              |
| Reporter           | `packages/reporter`                     | User report text                                                                      | Open writer model; numbers by code                         |
| Catalog + curation | `packages/catalog`, `packages/curation` | Manifest schema, approval gate, certification                                         | Deterministic                                              |
| Worker             | `apps/worker`                           | Queue, pipeline, delivery                                                             | —                                                          |
| Web + API          | `apps/web`                              | software.turbineh.com, `/v1`                                                          | —                                                          |

Test results, versions, licences and permissions are never decided by a model.

ADRs: user interaction [0005](adr/0005-user-interaction.md) · infrastructure [0006](adr/0006-infrastructure-for-speed.md) ·
sandbox and verification [0011](adr/0011-sandbox-and-verification.md) · delivery [0013](adr/0013-delivery-scope.md) ·
security remediation and report [0014](adr/0014-security-remediation-and-report.md) · integration, Backup Coder and
corrector [0015](adr/0015-integration-backup-coder-corrector.md).

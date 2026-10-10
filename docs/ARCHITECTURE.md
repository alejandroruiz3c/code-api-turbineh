# Architecture

See [PLAN §2](PLAN.md) for the full design and [ADR-0001](adr/0001-architecture.md) for the core decision.

| Module                                            | Package                 | Decides                                               |
| ------------------------------------------------- | ----------------------- | ----------------------------------------------------- |
| Decider                                           | `packages/decider`      | JEV / open alternative (classification, ranking, fit) |
| Intent Compiler                                   | `packages/compiler`     | Small open model → `BuildSpec`                        |
| Catalog                                           | `packages/catalog`      | Deterministic schema + approval gate                  |
| Backup Coder                                      | `packages/backup-coder` | Open coders, gaps only (T1–T6)                        |
| Selector, Resolver, Assembler, Verifier, Delivery | D1–D2                   | —                                                     |

User interaction: [ADR-0005](adr/0005-user-interaction.md). Infrastructure for speed: [ADR-0006](adr/0006-infrastructure-for-speed.md).

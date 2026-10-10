# ADR-0001 · Architecture: select before generate

- Status: accepted
- Date: 2026-10-10
- Context: docs/PLAN.md §1–§2

## Decision

A prompt-to-production generator built as a pipeline of modules with explicit ownership of each decision:

`Gateway → Abuse Guard → Intent Compiler → Selector → Resolver → Assembler → Verifier → (Corrector ↺) → Delivery`

| Decision type                                              | Who decides                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Classification, ranking, "does it fit?"                    | Decider (JEV or open alternative) behind the `Decider` interface |
| Version compatibility, licenses, permissions, test results | Deterministic code only — never a model                          |
| Prompt → BuildSpec, glue code, feedback text               | Small open-weights compiler model                                |
| Gaps the catalog cannot cover                              | Backup Coder (open-weights, ADR-0003), same verification         |

Repository: pnpm + turborepo monorepo, strict TypeScript. Model access is always behind an interface
(`packages/decider`, `packages/compiler`, `packages/backup-coder`) so backends are swapped by configuration.

## Model policy

**Open-weights models only, with the single exception of JEV (TypeSafe).** Every open model must be documented
in the TurbineH model knowledge base and carry a permissive licence (MIT / Apache-2.0 / OpenMDW).

## Consequences

- Every decision is traceable: input, candidates, decider probabilities, deterministic rule, evidence.
- Third-party code is only installed/built/tested inside an ephemeral sandbox without secrets (PLAN §5.4).

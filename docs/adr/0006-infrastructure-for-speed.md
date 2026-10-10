# ADR-0006 · Infrastructure for speed

- Status: proposed — **provider choice and spend need owner approval (Gate G0)**
- Date: 2026-10-10
- Context: owner request: the whole system must feel astonishingly fast, beyond the pipeline design itself.

All figures below are **targets** to be measured in `bench/`, not results.

## Principles

1. **One region for the data plane.** Workers, decider GPU, compiler endpoint, Postgres, package mirror, object
   storage and sandboxes live in the same EU region. Every cross-region hop is paid many times per build.
2. **Nothing cold on the critical path.** Models stay loaded, sandboxes are pre-booted, the base recipe is
   pre-installed, connections are pooled and kept alive.
3. **Fewer round-trips, not faster ones.** Batch every decider question for a state into one request; ask all
   capabilities of a build in as few decider calls as the context budget allows.
4. **Never wait for what can run in parallel.** Selection per capability, scans, typecheck/lint/unit run
   concurrently; delivery to GitHub is asynchronous (channel A is ready first).
5. **Cache by content.** Normalized BuildSpec → resolution; resolution → assembled skeleton; lockfile hash →
   installed `node_modules` snapshot.
6. **Stream everything.** SSE from the first millisecond; the UI shows progress before any model returns.

## Proposed topology

| Piece             | Proposal                                                                                                                                                  | Speed lever                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| UI                | Vercel (token available), edge-rendered home                                                                                                              | Instant first paint; prompt box usable before JS hydration |
| API + SSE + queue | Containers in the EU region, Postgres-backed queue (or Inngest — key available)                                                                           | Same-region DB, pooled connections                         |
| Decider (open)    | Quyet-1.0-Large on a dedicated 80 GB GPU in the same region, always warm, served with batching                                                            | No cold start, one request per state                       |
| Decider (JEV)     | TypeSafe API, kept-alive HTTP/2 client                                                                                                                    | Connection reuse; pinned model                             |
| Compiler          | Open small model on a low-latency EU provider (or a second GPU), **thinking disabled**, JSON-schema constrained decoding                                  | Short outputs, no reasoning tokens, no retries             |
| Backup Coder      | DeepSeek-V4.1-Flash / GLM-5.2 on an EU provider (ADR-0003)                                                                                                | Only on gaps; capped output tokens                         |
| Sandboxes         | Pool of pre-booted Firecracker microVMs (self-managed or a microVM platform in the EU region) with the recipe base, pnpm store and browsers pre-installed | No `pnpm install` from scratch; Playwright ready           |
| Packages          | Same-region npm mirror/proxy (read-only, allow-listed)                                                                                                    | Installs hit local disk, not the internet                  |
| Build caches      | Turborepo/Next.js build cache per recipe in the region                                                                                                    | Incremental builds                                         |
| Artefacts         | Same-region object storage, git bundle produced inside the sandbox                                                                                        | Result viewable before GitHub push                         |

## Latency budget per build (targets)

| Phase                                              | Target                                 |
| -------------------------------------------------- | -------------------------------------- |
| Guard + clarify (one batched decider call)         | well under 1 s                         |
| Compile (constrained, no thinking)                 | a few seconds                          |
| Select + resolve (batched decider + deterministic) | about 1 s                              |
| Assemble from warm skeleton                        | seconds                                |
| Verify (parallel, warm sandbox)                    | the largest phase; minimized by caches |
| Deliver channel A                                  | immediate after verify                 |

## Decisions needed from the owner

1. GPU host for Quyet-Large in the EU (and whether to colocate the compiler on it).
2. Inference provider (EU) for the Backup Coder and, optionally, the compiler.
3. Sandbox platform (self-managed Firecracker vs managed microVMs in the EU).
4. Budget ceiling for D1–D3 (feeds the global cost circuit breaker).

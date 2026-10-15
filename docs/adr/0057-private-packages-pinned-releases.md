# ADR-0057 · Private packages as separate repositories, consumed at pinned releases

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: ADR-0053 moved the orchestration engine out of the public tree into `private/orchestration`, an unversioned
  local git checkout without a remote: deploys took whatever commit happened to be checked out, nothing recorded which
  engine version production ran, and only one operator machine had it. The owner decided that TurbineH's orchestrators
  become separate private products ("two different ones: the agent inference orchestrator and the resource-decision
  one; we will use them later as products of their own").

## Decision

- Each private package is its own private GitHub repository with its own toolchain, tests, CI and semver releases
  (immutable annotated tags). The agent inference orchestrator is the first one; the resource-decision orchestrator
  uses the same mechanism with its own entry.
- `infra/private/versions.json` (public) pins each package as `packages.<name>` with `repo`, `tag`, `commit`,
  `requiredBy` and an optional `contract`. Only pins live in the public history, never code. `requiredBy` lists the deploy targets (`web`,
  `worker`) that need the package; `contract` names a file the package vendors from this repository.
- `infra/private/sync.sh` checks each package out at `private/<name>` (git-ignored): clone or fetch the tag, verify the
  tag resolves to the pinned commit (a moved tag fails), check out that commit detached, refuse local changes, compare
  the vendored contract with this checkout, and print `repo tag (sha)`. `--check` verifies offline, `--validate` only
  validates the file (public CI), `--for <target>` selects by `requiredBy`.
- `infra/staging/deploy.sh` runs `sync.sh --for <target>` for every target it deploys, before taking the lock or
  deploying anything, so a missing or mismatched package never results in a partial deploy.
- The web app loads the agent orchestrator from `private/agent-orchestrator/src/index.ts` (alias of
  `@turbineh/orchestration/engine`, unchanged mechanism); `private/orchestration` is no longer read, and is never
  uploaded. The open fallback keeps the public repository's CI green without access to private repositories.

## Consequences

- Production runs a known, reviewed, reproducible engine release; upgrading or rolling back is a one-line PR to the
  pin.
- Deploys need read access to the private repositories (the operator's GitHub CLI login).
- An interface change needs three steps in order: public interface, engine release with the new vendored contract,
  pin. Until the pin is updated, deploys refuse (the contract check), which is intended.
- Open: the worker deploy still rsyncs the whole working tree, including `private/`; restricting it to the packages
  workers require is a follow-up once a worker package exists.

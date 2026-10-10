# ADR-0007 · GitHub organization and repository visibility

- Status: accepted (owner delegated the decision on 2026-10-10)
- Date: 2026-10-10

## Decision

- Create a GitHub **organization `turbineh`** (name available on 2026-10-10) owned by the founder's account.
  Company code never lives in a personal account: it keeps ownership clear, allows teams/CODEOWNERS, org-level
  secrets and the GitHub App required for delivery (PLAN §7.1), and survives personnel changes.
- Repository **`turbineh/code-api-turbineh`**, **private** until the D3 release review, then switched to
  **public** for the hackathon (PLAN §11 D3: "repo público + benchmark"). The release review checks: history
  scan with gitleaks, licence file present, no internal-only documents, numbers only from `bench/`.
- Branch protection on `main`: PR required, CI checks required, no force-push.
- Customer deliveries (channel C) use a **separate** organization or a dedicated namespace inside `turbineh` with
  its own GitHub App, so product code and customer repos never share permissions.
- The YES IF landing (`yes-if-landing/web`, currently without remote) moves to `turbineh/yes-if-landing` (private)
  once the owner confirms.

## Consequences

- Organizations cannot be created through the API with a personal token: the owner creates `turbineh` once in the
  GitHub web UI and grants the fine-grained token access to it (Administration, Contents, Workflows, Pull requests).

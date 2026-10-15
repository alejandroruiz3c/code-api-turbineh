# ADR-0007 · GitHub account and repository visibility

- Status: accepted (owner decision, 2026-10-10)
- Date: 2026-10-10

## Decision

- No organization for now (owner decision). The repository lives in the owner's personal account:
  **`alejandroruiz3c/code-api-turbineh`**, **private** until the D3 release review, then public for the hackathon
  (PLAN §11 D3). The release review checks: full-history gitleaks scan, LICENSE present, no internal-only
  documents, numbers only from `bench/`.
- Branch protection on `main`: PR required, CI checks required, no force-push.
- The repository can be transferred to an organization later without losing history, issues or redirects.
- Customer deliveries into a TurbineH GitHub namespace (channel C) are out of scope — see ADR-0013. Users get the
  complete package and can push it to their own GitHub (channel B).
- Token: fine-grained, scoped to the repositories it must touch.

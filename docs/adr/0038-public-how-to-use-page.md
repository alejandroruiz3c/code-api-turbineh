# ADR-0038 · Public "How to use" page and Bearer access to the catalogue index

- Status: accepted
- Date: 2026-10-13
- Context: the owner asked for one section on software.turbineh.com that explains the three ways to use the product
  (people on the web, coding agents with the CLI/MCP, any app with the API). `/cli` and `/docs` covered parts of it
  and were behind the invitation gate (ADR-0030). The agent-readable catalogue index (`/catalog/index.json`,
  `/catalog/llms.txt`, ADR-0032) answered every API caller with a 307 to the HTML access page.

## Decision

- **`/use` is public.** It explains how to get in, so it cannot require being in. It shows no token, no workspace data
  and no figures; every command on it is checked against the CLI help in a test. `proxy.ts` allows exactly `/use`
  (`PUBLIC_PAGES`); everything else stays gated.
- **`/cli` and `/docs` are merged into `/use`** and redirect (307, `next.config.ts`) to `/use#agents` and `/use#api`, so
  nothing is maintained twice. The navigation shows one "How to use" link.
- **The catalogue index accepts the invitation token as `Authorization: Bearer`**, like `/v1/capabilities`, or the
  browser cookie. It is not made public: ADR-0030 keeps the product and its catalogue behind the invitation. A missing
  or wrong Bearer gets a 401 problem document (`code: unauthorized`) instead of a redirect; a browser without the cookie
  still goes to `/access`. Only the invitation token is checked in the proxy (no database there): API keys (`tbh_…`)
  use `/v1/capabilities`.

## Consequences

- Agents can read `/catalog/llms.txt` with the same token they already use for the CLI and the API.
- Old links to `/cli` and `/docs` keep working.

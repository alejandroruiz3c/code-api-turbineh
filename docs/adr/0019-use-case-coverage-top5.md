# ADR-0019 · Coverage of the most common AI-built software (top-5 research)

- Status: accepted (owner request, 2026-10-11)
- Date: 2026-10-11
- Related: ADR-0018 (public-site recipes), ADR-0012 (catalog)

## Research (2026, platform data; not representative surveys)

| Use case                                       | Share reported                                             | Coverage before → after                            |
| ---------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Websites (business, portfolio, landing)        | 26 % (BigIdeasDB) · 49 % on Hostinger Horizons             | landing, corporate-site                            |
| Business / internal tools, CRM                 | 22 %                                                       | saas-crud, internal-tool                           |
| Task and project management                    | ~21 % ("standard starter project", Questera/Greta)         | none → **projects**                                |
| Consumer apps (habit, fitness, money trackers) | 12 %                                                       | none → **tracker**                                 |
| Dashboards and analytics                       | 9 % (28 % of traffic on Taskade)                           | components only → **analytics-dashboard**          |
| E-commerce                                     | 7–10 %                                                     | storefront                                         |
| Paying micro-SaaS                              | 30 % of vibe-coded businesses taking payments (BigIdeasDB) | one-off payments only → **payments.subscriptions** |
| AI apps (assistants, agents, chat)             | 3.1 % of projects (VULK)                                   | Phase 3 (component #001 + AI Safety Pack)          |

AI agents are not in the top 5, so the orchestrator stays in Phase 3 as planned (PLAN §2.3, §13).

## Decision

- Three recipes: `projects` (kanban, assignees, priorities, due dates, comments, my tasks), `analytics-dashboard`
  (CSV import validated per row, exact KPIs with previous-period comparison, accessible native SVG charts, filters,
  export), `tracker` (habits and daily amounts, goals, streaks, 30-day history; strictly per user).
- Native component `payments.subscriptions.turbineh`: Stripe Billing over REST (Checkout in subscription mode,
  Customer Portal), signed webhook as the only writer, `requirePlan("pro")`, owner/admin-only plan changes. Native
  components can now add menu entries (`files/nav.json`).
- Same bar as every recipe: unit + E2E tests, verification in the sandbox (payments and subscriptions against
  Stripe's official simulator), security and authorization rules, no new dependencies in templates.

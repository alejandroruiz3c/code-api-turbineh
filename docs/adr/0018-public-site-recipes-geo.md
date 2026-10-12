# ADR-0018 · Public-site recipes (landing, corporate site, storefront), security and GEO by default

- Status: accepted (owner request, 2026-10-11)
- Date: 2026-10-11
- Related: ADR-0012 (catalog), ADR-0014 (security), ADR-0016 (brand), ADR-0017 (deploy for me)

## Decision

Coverage now includes websites and online shops, not only management apps:

| Recipe                        | What it is                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `landing-waitlist` (extended) | Hero, benefits, how it works, FAQ, call to action, waitlist with confirmation email                     |
| `corporate-site` (new)        | Home, services, about, blog (safe Markdown, RSS), contact form, admin to edit texts, posts and messages |
| `storefront` (new)            | Catalog with images, search, cart, Stripe Checkout (hosted), signed webhook, orders and stock, admin    |

Copy for public pages comes from a new optional, validated `site` part of the BuildSpec (small model), only awaited
for public-site recipes, with a deterministic fallback.

## Security by default in everything we write (native components)

- Inputs validated with Zod; admin areas behind `requireAdmin`; public actions rate-limited, with honeypots, and
  explicitly annotated as public.
- Files and images typed by content (magic bytes), size-limited, served with `nosniff`; no SVG.
- Markdown rendered as React elements (no raw HTML), links restricted to http(s), mailto and site paths.
- JSON-LD and RSS escaped; prices always read from the database; Stripe webhook verified (HMAC-SHA256, constant time,
  5-minute tolerance), idempotent, stock updated in the same transaction; redirect only to `checkout.stripe.com`.
- No payment SDK and no card data in the app (Stripe-hosted Checkout).

## GEO (generative engine optimisation) by default

- `/llms.txt`: concise, factual summary (services, products with prices and availability, FAQ, key pages).
- JSON-LD: `Organization`, `WebSite`, `FAQPage`, `Article`, `Product` with `Offer` and availability.
- `robots.txt`: public pages open to search engines **and AI crawlers** (GPTBot, OAI-SearchBot, ClaudeBot,
  PerplexityBot, Google-Extended, …), private areas (`/dashboard`, `/api`, cart, checkout) closed; one switch
  (`AI_CRAWLERS_ALLOWED` in `src/lib/geo.ts`) to opt out.
- Semantic HTML (one `h1`, headed sections, question/answer FAQ), canonical URLs, sitemaps with last modification.

## Limits

- Payments are verified in every shop build against Stripe's official simulator (stripe-mock) on the isolated
  network: Checkout Session creation, signed webhook (sent twice), order paid, stock and cart updated. A live
  payment with the client's own Stripe keys (test mode first) remains their go-live check.
- Shipping rates and taxes are not calculated (flat prices); multi-variant products are future work.

# ADR-0020 · Storefront: product options, shipping and taxes

- Status: accepted (owner request, 2026-10-12)
- Date: 2026-10-12
- Related: ADR-0018 (public-site recipes), ADR-0019 (use-case coverage)

## Context

The `storefront` recipe covered catalog, cart, Stripe Checkout, orders and stock. Real shops also need product
options (size, colour…), shipping that depends on the destination and taxes by country. These were the gaps left
from block 2.

## Decision

- **Options (variants)**: `product_variants` with name, optional unique SKU, optional price override (null = product
  price) and own stock (null = unlimited). A product with active options is always bought through one of them (checked
  on the server). Cart lines and order items keep `variant_id`; order items also copy the option name and SKU so the
  history survives later edits. The paid-order webhook decrements the option's stock (or the product's when there is
  no option) in the same transaction as the status change, so retries change stock only once.
- **Shipping**: admin-managed flat rates with a country list (empty = every country) and an optional free-from
  amount. The buyer picks the country and option on the cart page with a plain GET form (works without JavaScript).
  The checkout action recomputes everything from the database; Stripe receives the same amount as a fixed
  `shipping_options` entry, and the address collection is restricted to the quoted country.
- **Taxes**: one rate per country in basis points (`2100` = 21 %), `*` as the default for other countries.
  `SHOP_PRICES_INCLUDE_TAX` (default `true`, usual in the EU) decides whether prices contain tax or tax is added on
  top. It is a deployment setting, not an admin toggle, because changing it changes the meaning of every stored
  price.
- **Rounding**: integer cents only. Tax applies to goods and shipping together and is computed once on that sum
  (not per line), rounded half up to the cent. Inclusive: `tax = total − round(total ÷ (1 + rate))`. Exclusive:
  `tax = round(base × rate)`, sent to Stripe as one extra line so Stripe charges exactly the order total.
- The order stores subtotal, shipping, tax, tax label, shipping name and country. Cart, admin orders and emails show
  the same breakdown (`orderSummary`).
- GEO: the product JSON-LD has one `Offer` per option with its SKU, price and availability.

## Not included (on purpose)

Stripe Tax and automatic tax registration, weight- or carrier-based shipping, discounts or coupons, multi-currency.
They depend on the client's own Stripe or carrier accounts and stay as next steps.

## Consequences

Tax and shipping amounts are deterministic and tested (unit tests for the arithmetic, E2E against stripe-mock for the
whole purchase). The shop's admin must create at least one shipping option for physical goods; without options,
orders need no shipping (digital goods or pick-up).

# ADR-0025 · Storefront: automatic Stripe Tax, discount codes and several currencies

- Status: accepted (owner request, 2026-10-12)
- Date: 2026-10-12
- Extends: ADR-0020 (variants, shipping and taxes by country).

## Decision

### Stripe Tax (optional)

`SHOP_TAX_MODE=manual|stripe` (default `manual`, the per-country rates of ADR-0020).

- `stripe`: Checkout gets `automatic_tax[enabled]=true`, every amount (lines and shipping) carries
  `tax_behavior` (`inclusive` when `SHOP_PRICES_INCLUDE_TAX=true`, else `exclusive`) and an address is always
  collected (shipping address, or `billing_address_collection=required` without shipping). The cart shows "tax is
  calculated on the payment page".
- The order is created with tax 0 and `tax_mode=stripe`; the signed `checkout.session.completed` event is the only
  source of the charged tax and total (`total_details.amount_tax`, `amount_total`), accepted only as whole
  non-negative cents in the order's currency (`stripePaidAmounts`). Nothing from the browser is trusted.
- The client must activate Stripe Tax and add tax registrations in their Stripe dashboard (stated in `.env.example`,
  hence in `DEPLOY.md`, and in the admin's Taxes card).
- Verification: stripe-mock (pinned) accepts these parameters but returns placeholder amounts, so the recorded values
  are tested from the signed webhook payload (unit tests) and the request body is unit-tested.

### Discount codes

- Table `coupons`: upper-case unique code (matched case-insensitively), percent (basis points) or fixed amount in one
  currency, optional minimum order (needs a currency), maximum uses, last valid day, active flag.
- Applied on the server in the quote: discount on goods only, integer cents, percent rounded half up, never above the
  goods subtotal; shipping's free-from threshold uses the discounted goods; tax is computed once on discounted goods +
  shipping (same rules as ADR-0020). Re-validated at checkout; if the code stopped applying, checkout refuses rather
  than charging without the discount the buyer expected.
- Abuse: 8 code attempts per minute per address; the same answer for unknown and inactive codes.
- Uses are counted only by the signed payment webhook, in the payment transaction, with a conditional increment
  (`redemptions < max_redemptions`): the count never exceeds the maximum even with simultaneous payments. A payment
  that arrives after the last use was taken is honoured (the buyer already paid) and the admin email says so.
- Stripe receives the discounted order as ONE exact line ("Order XXXX", description listing items and the code):
  spreading a discount over lines with quantities cannot always be exact to the cent, and Stripe coupon objects would
  have to be created in the client's account. Stripe's total therefore always equals our quote.

### Several currencies

- `SHOP_CURRENCY` stays the base currency; `SHOP_CURRENCIES` lists extra ones. No exchange rates: the admin sets
  explicit prices per extra currency for the product and, optionally, each option (`product_prices`). An option that
  inherits the product's base price inherits its price in other currencies; an option with its own base price needs
  its own price there. Without a price the product/option is shown as "not sold in USD" and cannot be bought in it.
- The buyer picks the currency (cookie `shop_currency`, validated against the enabled list; redirect back only to
  same-site paths). Shipping rates have a currency (null = base) and are offered only in it; fixed-amount codes and
  minimums are in their own currency; percent codes without a minimum work in any currency.
- Orders store their currency; Stripe Checkout is created in it; all amounts are formatted with `Intl`.
- GEO: JSON-LD has one `Offer` per option and currency with an explicit price.

## Out of scope

Exchange-rate conversion, Stripe coupon/promotion-code objects, per-line tax categories (Stripe Tax uses the account's
default tax code), tax-exempt customers.

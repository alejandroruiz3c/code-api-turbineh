import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Products (recipe storefront). Prices are integer cents; stock null = unlimited. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(),
    stock: integer("stock"),
    active: boolean("active").notNull().default(true),
    image: bytea("image"),
    imageMime: varchar("image_mime", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_active_idx").on(t.active, t.createdAt)],
);

/**
 * Discount codes managed by the admin. Codes are stored upper-case and matched case-insensitively.
 * kind "percent": percentBp basis points (1000 = 10 %); kind "amount": amountCents in `currency`.
 * currency null = valid in every currency (percent codes without a minimum only).
 */
export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  kind: varchar("kind", { length: 8 }).notNull(),
  percentBp: integer("percent_bp"),
  amountCents: integer("amount_cents"),
  currency: varchar("currency", { length: 3 }),
  minSubtotalCents: integer("min_subtotal_cents"),
  maxRedemptions: integer("max_redemptions"),
  /** Paid orders that used the code; incremented only by the signed payment webhook, never above the maximum. */
  redemptions: integer("redemptions").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Anonymous carts identified by an unguessable httpOnly cookie. */
export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Variants of a product (size, colour…): own SKU, optional price override (null = product price) and own stock
 * (null = unlimited). A product with active variants is bought through one of them.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    sku: varchar("sku", { length: 64 }).unique(),
    priceCents: integer("price_cents"),
    stock: integer("stock"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_variants_product_idx").on(t.productId, t.active)],
);

/**
 * Fixed prices in the shop's extra currencies (SHOP_CURRENCIES), set by the admin: no exchange rates, so every
 * amount a buyer sees and pays is the one the admin wrote. variant_id null = the product's price. A product (or an
 * option with its own base price) without a price in a currency is not sold in that currency.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [unique("product_prices_one").on(t.productId, t.variantId, t.currency).nullsNotDistinct()],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  // One line per product and variant (a product without variants has variant_id null).
  (t) => [unique("cart_items_line").on(t.cartId, t.productId, t.variantId).nullsNotDistinct()],
);

/**
 * Shipping rates managed by the admin. countries: ISO codes separated by commas; empty = every country.
 * Amounts are in `currency` (null = the shop's base currency); a rate is offered only in its own currency.
 */
export const shippingRates = pgTable("shipping_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  currency: varchar("currency", { length: 3 }),
  name: varchar("name", { length: 80 }).notNull(),
  countries: varchar("countries", { length: 1000 }).notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  freeOverCents: integer("free_over_cents"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tax rate per country in basis points (2100 = 21 %). Country "*" applies where no specific rate exists. */
export const taxRates = pgTable("tax_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  country: varchar("country", { length: 2 }).notNull().unique(),
  label: varchar("label", { length: 40 }).notNull(),
  rateBp: integer("rate_bp").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Orders: created as pending at checkout, marked paid only by the signed Stripe webhook. */
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  cartId: uuid("cart_id"),
  email: varchar("email", { length: 320 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  /**
   * Breakdown computed on the server at checkout (integer cents):
   * total = subtotal − discount + shipping (+ tax when prices exclude it).
   * With Stripe Tax, tax and total are replaced by the amounts in Stripe's signed payment event.
   */
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  couponId: uuid("coupon_id"),
  couponCode: varchar("coupon_code", { length: 40 }),
  /** "manual" (the shop's own rates) or "stripe" (Stripe Tax computed it at checkout). */
  taxMode: varchar("tax_mode", { length: 8 }).notNull().default("manual"),
  shippingCents: integer("shipping_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  taxLabel: varchar("tax_label", { length: 60 }),
  shippingName: varchar("shipping_name", { length: 80 }),
  country: varchar("country", { length: 2 }),
  totalCents: integer("total_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id"),
  variantId: uuid("variant_id"),
  name: varchar("name", { length: 160 }).notNull(),
  variantName: varchar("variant_name", { length: 80 }),
  sku: varchar("sku", { length: 64 }),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
});

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

/** Anonymous carts identified by an unguessable httpOnly cookie. */
export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
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

/** Shipping rates managed by the admin. countries: ISO codes separated by commas; empty = every country. */
export const shippingRates = pgTable("shipping_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  /** Breakdown computed on the server at checkout (integer cents); total = subtotal + shipping (+ tax if excluded). */
  subtotalCents: integer("subtotal_cents").notNull().default(0),
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

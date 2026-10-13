import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ADMIN_STATE = "playwright/.auth/owner.json";

/** Emails the app logged (no provider in tests): one JSON line per email, see src/lib/email.ts. */
function outbox(): { to: string; subject: string }[] {
  const file = process.env.EMAIL_OUTBOX_FILE ?? "";
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string });
}

/** Signs a webhook exactly like Stripe does (t=…,v1=HMAC-SHA256 of "t.body"). */
function stripeSignature(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

test.describe.serial("storefront", () => {
  test("the admin creates a product with an image", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name").fill("Linen Shirt");
    await page.getByLabel(/^Price/).fill("49.90");
    await page.getByLabel("Description").fill("A breathable linen shirt for summer days.");
    await page.getByLabel(/Stock/).fill("5");
    await page
      .getByLabel(/upload an image/)
      .setInputFiles({ name: "shirt.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("cell", { name: "Linen Shirt" })).toBeVisible();
  });

  test("the admin adds a product with an https image URL; shoppers find it by its description", async ({
    page,
  }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name").fill("Ethiopia Yirgacheffe");
    await page.getByLabel(/^Price/).fill("18.50");
    await page
      .getByLabel("Description")
      .fill("Washed single origin with jasmine and bergamot notes.");
    await page.getByLabel(/^Image URL/).fill("https://images.example.com/yirgacheffe.jpg");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("cell", { name: "Ethiopia Yirgacheffe" })).toBeVisible();

    await page.goto("/shop?q=bergamot");
    await expect(page.getByRole("img", { name: "Ethiopia Yirgacheffe" })).toHaveAttribute(
      "src",
      "https://images.example.com/yirgacheffe.jpg",
    );
    await page.goto("/shop?q=no-such-coffee");
    await expect(page.getByText("No products found.")).toBeVisible();
  });

  test("an image URL that is not https is refused by the server", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name").fill("Plain HTTP Mug");
    await page.getByLabel(/^Price/).fill("9.00");
    await page.getByLabel("Description").fill("A mug whose image is not served securely.");
    // Bypass the browser's own checks: the server must refuse it too.
    await page.getByLabel(/^Image URL/).evaluate((el) => {
      el.removeAttribute("pattern");
      el.setAttribute("type", "text");
    });
    await page.getByLabel(/^Image URL/).fill("http://images.example.com/mug.jpg");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.goto("/dashboard/products");
    await expect(page.getByRole("cell", { name: "Plain HTTP Mug" })).toHaveCount(0);
  });

  test("an out-of-stock product cannot be added to the cart", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name").fill("Sold Out Scarf");
    await page.getByLabel(/^Price/).fill("19.00");
    await page.getByLabel("Description").fill("Our most popular scarf, back soon.");
    await page.getByLabel(/Stock/).fill("0");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("cell", { name: "Sold Out Scarf" })).toBeVisible();
    await page.goto("/shop/sold-out-scarf");
    await expect(page.getByText("Out of stock")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
  });

  test("the admin sets shipping by country and a tax rate", async ({ page }) => {
    await page.goto("/dashboard/shipping");
    await page.getByLabel("Shipping name").fill("Standard");
    await page.getByLabel(/^Countries/).fill("es, pt");
    await page.getByLabel(/^Shipping price/).fill("4.90");
    await page.getByLabel(/^Free shipping from/).fill("150");
    await page.getByRole("button", { name: "Add shipping option" }).click();
    await expect(page.getByRole("cell", { name: "Standard" })).toBeVisible();
    await page.getByLabel(/^Tax country/).fill("ES");
    await page.getByLabel("Tax name").fill("VAT");
    await page.getByLabel(/^Tax rate/).fill("21");
    await page.getByRole("button", { name: "Save tax rate" }).click();
    await expect(page.getByRole("cell", { name: "21 %" })).toBeVisible();
  });

  test("the admin adds options with their own SKU, price and stock", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name", { exact: true }).fill("Cotton Tee");
    await page.getByLabel(/^Price/).fill("20.00");
    await page.getByLabel("Description").fill("Organic cotton t-shirt in two sizes.");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.getByRole("link", { name: "Cotton Tee", exact: true }).click();
    for (const o of [
      { name: "S", sku: "TEE-S", price: "", stock: "1" },
      { name: "L", sku: "TEE-L", price: "22.00", stock: "3" },
    ]) {
      await page.getByLabel("Option name").fill(o.name);
      await page.getByLabel(/^SKU/).fill(o.sku);
      await page.getByLabel(/^Option price/).fill(o.price);
      await page.getByLabel(/^Option stock/).fill(o.stock);
      await page.getByRole("button", { name: "Add option" }).click();
      await expect(page.getByRole("cell", { name: o.sku, exact: true })).toBeVisible();
    }
  });

  test("the admin creates a one-use discount code", async ({ page }) => {
    await page.goto("/dashboard/coupons");
    await page.getByLabel("Code", { exact: true }).fill("Save10");
    await page.getByLabel("Percent off").check();
    await page.getByLabel(/^Discount value/).fill("10");
    await page.getByLabel(/^Maximum uses/).fill("1");
    await page.getByRole("button", { name: "Create code" }).click();
    await expect(page.getByRole("cell", { name: "SAVE10", exact: true })).toBeVisible();
    await expect(page.getByTestId("coupon-used-SAVE10")).toHaveText("0 / 1");
  });

  test("the admin sells in a second currency with explicit prices and shipping", async ({
    page,
  }) => {
    await page.goto("/dashboard/products");
    await page.getByRole("link", { name: "Linen Shirt", exact: true }).click();
    await page.getByLabel("Product price in USD").fill("54.00");
    await page.getByRole("button", { name: "Save prices" }).click();
    await expect(page.getByLabel("Product price in USD")).toHaveValue("54.00");

    await page.goto("/dashboard/shipping");
    await page.getByLabel("Shipping name").fill("US Standard");
    await page.getByLabel(/^Countries/).fill("us");
    await page.getByLabel(/^Shipping price/).fill("9.00");
    await page.getByLabel("Shipping currency").selectOption("usd");
    await page.getByRole("button", { name: "Add shipping option" }).click();
    await expect(page.getByRole("cell", { name: "US Standard" })).toBeVisible();
  });

  test("the admin updates a product's price and the public catalogue shows it at once", async ({
    page,
  }) => {
    await page.goto("/dashboard/products");
    await page.getByLabel("Name", { exact: true }).fill("Price Test Mug");
    await page.getByLabel(/^Price/).fill("10.00");
    await page.getByLabel("Description").fill("A mug used to check price updates.");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.getByRole("link", { name: "Price Test Mug", exact: true }).click();
    await page.getByLabel(/^Price/).fill("12.50");
    await page.getByRole("button", { name: "Save product" }).click();
    // The action redirects back to the list once saved.
    await expect(page).toHaveURL(/\/dashboard\/products$/);
    await page.goto("/shop/price-test-mug");
    await expect(page.getByTestId("price")).toContainText("12.50");
  });

  test.describe("shopper", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    // The Stripe API is the local mock (tests/e2e/mocks/STRIPE_API_BASE.mjs); Stripe's hosted page is answered here.
    test.beforeEach(async ({ page }) => {
      await page.route("https://checkout.stripe.com/**", (route) =>
        route.fulfill({ body: "Stripe Checkout (mock)", contentType: "text/plain" }),
      );
    });

    test("shoppers search the catalogue by product name: only matching products are listed", async ({
      page,
    }) => {
      await page.goto("/shop");
      await page
        .getByRole("searchbox")
        .or(page.getByLabel("Search products"))
        .first()
        .fill("linen");
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.getByRole("link", { name: /Linen Shirt/ }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /Cotton Tee/ })).toHaveCount(0);
    });

    test("a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal", async ({
      page,
    }) => {
      await page.goto("/shop/linen-shirt");
      await page.getByRole("button", { name: "Add to cart" }).click();
      await expect(page).toHaveURL(/\/cart/);
      await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");
      await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");
      await page.getByLabel("Quantity of Linen Shirt").fill("3");
      await page.getByRole("button", { name: "Update", exact: true }).click();
      await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");
    });

    test("pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged", async ({
      page,
      browser,
      request,
    }) => {
      await page.goto("/shop?q=linen");
      await page
        .getByRole("link", { name: /Linen Shirt/ })
        .first()
        .click();
      await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();
      await expect(page.getByTestId("price")).toContainText("49.90");
      await page.getByLabel("Quantity").fill("2");
      await page.getByRole("button", { name: "Add to cart" }).click();
      await expect(page.getByTestId("cart-total")).toContainText("99.80");

      await page.goto("/shop/cotton-tee");
      await expect(page.getByTestId("price")).toContainText("From");
      await page.getByLabel(/^L —/).check();
      await page.getByRole("button", { name: "Add to cart" }).click();
      await expect(page.getByText("Cotton Tee — L")).toBeVisible();
      await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");

      // Country and shipping are chosen on the cart page (plain GET form); every amount is computed on the server.
      await page.getByLabel("Ship to").selectOption("ES");
      await page.getByRole("button", { name: "Update shipping" }).click();
      await expect(page.getByTestId("cart-shipping")).toContainText("4.90");
      // Prices include tax by default: 126.70 contains 21.99 of VAT at 21 %.
      await expect(page.getByTestId("cart-tax")).toContainText("21.99");
      await expect(page.getByTestId("cart-total")).toContainText("126.70");

      await page.getByLabel(/Email for your receipt/).fill("buyer@example.com");
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_/);

      const admin = await browser.newContext({ storageState: ADMIN_STATE });
      const adminPage = await admin.newPage();
      await adminPage.goto("/dashboard/orders");
      const row = adminPage.locator('tr[data-status="pending"]').first();
      const orderId = (await row.getAttribute("data-order-id")) ?? "";
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(row).toContainText("126.70");

      const event = JSON.stringify({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_e2e",
            client_reference_id: orderId,
            payment_status: "paid",
            customer_details: { email: "buyer@example.com" },
          },
        },
      });
      for (let i = 0; i < 2; i++) {
        // Sent twice: Stripe may retry, the order must be paid and stock decremented exactly once.
        const res = await request.post("/api/stripe/webhook", {
          data: event,
          headers: {
            "content-type": "application/json",
            "stripe-signature": stripeSignature(event),
          },
        });
        expect(res.status()).toBe(200);
      }

      await adminPage.goto("/dashboard/orders");
      await expect(adminPage.locator(`tr[data-order-id="${orderId}"]`)).toHaveAttribute(
        "data-status",
        "paid",
      );
      await adminPage.goto("/dashboard/products");
      await expect(adminPage.getByTestId("stock-Linen Shirt")).toHaveText("3");
      // The option's own stock went down, not the product's.
      await adminPage.getByRole("link", { name: "Cotton Tee", exact: true }).click();
      await expect(adminPage.getByTestId("variant-stock-L")).toHaveValue("2");
      await expect(adminPage.getByTestId("variant-stock-S")).toHaveValue("1");
      await admin.close();

      // The confirmation email went to the shopper exactly once (logged: no email provider in tests).
      expect(
        outbox().filter(
          (m) => m.to === "buyer@example.com" && m.subject === "Your order is confirmed",
        ),
      ).toHaveLength(1);

      await page.goto("/cart");
      await expect(page.getByText("Your cart is empty")).toBeVisible();
    });

    test("uses a discount code: applied on the server, counted once on payment, then used up", async ({
      page,
      browser,
      request,
    }) => {
      await page.goto("/shop/linen-shirt");
      await page.getByRole("button", { name: "Add to cart" }).click();
      await page.getByLabel("Ship to").selectOption("ES");
      await page.getByRole("button", { name: "Update shipping" }).click();
      await expect(page.getByTestId("cart-total")).toContainText("54.80");

      // Case-insensitive code; 10 % of 49.90 = 4.99, then 4.90 shipping; 49.81 contains 8.64 of VAT at 21 %.
      await page.getByLabel("Discount code").fill("save10");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByTestId("cart-discount")).toContainText("4.99");
      await expect(page.getByTestId("cart-tax")).toContainText("8.64");
      await expect(page.getByTestId("cart-total")).toContainText("49.81");

      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_/);

      const admin = await browser.newContext({ storageState: ADMIN_STATE });
      const adminPage = await admin.newPage();
      await adminPage.goto("/dashboard/orders");
      const row = adminPage.locator('tr[data-status="pending"]').first();
      const orderId = (await row.getAttribute("data-order-id")) ?? "";
      await expect(row).toContainText("49.81");

      const event = JSON.stringify({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_e2e_coupon",
            client_reference_id: orderId,
            payment_status: "paid",
            amount_total: 4981,
            currency: "eur",
            total_details: { amount_tax: 864 },
          },
        },
      });
      for (let i = 0; i < 2; i++) {
        const res = await request.post("/api/stripe/webhook", {
          data: event,
          headers: {
            "content-type": "application/json",
            "stripe-signature": stripeSignature(event),
          },
        });
        expect(res.status()).toBe(200);
      }
      await adminPage.goto("/dashboard/coupons");
      // Counted once although Stripe delivered the event twice.
      await expect(adminPage.getByTestId("coupon-used-SAVE10")).toHaveText("1 / 1");
      await admin.close();

      // The code reached its limit: a new buyer cannot use it.
      const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const otherPage = await other.newPage();
      await otherPage.goto("/shop/linen-shirt");
      await otherPage.getByRole("button", { name: "Add to cart" }).click();
      await otherPage.getByLabel("Discount code").fill("SAVE10");
      await otherPage.getByRole("button", { name: "Apply" }).click();
      await expect(otherPage.getByText("This code has been fully used.")).toBeVisible();
      await other.close();
    });

    test("pays in a second currency: fixed prices, shipping in that currency, order in USD", async ({
      page,
      browser,
    }) => {
      await page.goto("/shop");
      await page.getByLabel("Currency").selectOption("usd");
      await page.getByRole("button", { name: "Change" }).click();
      await expect(page.getByRole("link", { name: /Linen Shirt/ }).first()).toContainText("54.00");
      // No price in USD for the tee: shown as not sold, never converted.
      await expect(page.getByRole("link", { name: /Cotton Tee/ }).first()).toContainText(
        "Not sold in USD",
      );

      await page.goto("/shop/linen-shirt");
      await expect(page.getByTestId("price")).toContainText("US$54.00");
      await page.getByRole("button", { name: "Add to cart" }).click();
      await page.getByLabel("Ship to").selectOption("US");
      await page.getByRole("button", { name: "Update shipping" }).click();
      await expect(page.getByTestId("cart-shipping")).toContainText("9.00");
      await expect(page.getByTestId("cart-total")).toContainText("US$63.00");

      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_/);

      const admin = await browser.newContext({ storageState: ADMIN_STATE });
      const adminPage = await admin.newPage();
      await adminPage.goto("/dashboard/orders");
      await expect(adminPage.locator('tr[data-status="pending"]').first()).toContainText(
        "US$63.00",
      );
      await admin.close();
    });

    test("rejects webhooks without a valid signature", async ({ request }) => {
      const res = await request.post("/api/stripe/webhook", {
        data: { type: "checkout.session.completed" },
        headers: { "stripe-signature": "t=1,v1=00" },
      });
      expect(res.status()).toBe(400);
    });

    test("is ready for search and AI answer engines", async ({ request }) => {
      expect(await (await request.get("/llms.txt")).text()).toContain("Linen Shirt");
      const robots = await (await request.get("/robots.txt")).text();
      expect(robots).toContain("GPTBot");
      expect(robots).toContain("Disallow: /cart");
      expect(await (await request.get("/sitemap.xml")).text()).toContain("/shop/linen-shirt");
      // One schema.org offer per option, with its SKU and price.
      const tee = await (await request.get("/shop/cotton-tee")).text();
      expect(tee).toContain('"sku":"TEE-L"');
      expect(tee).toContain('"price":"22.00"');
    });
  });

  test("the admin sees every order with its payment status in the orders section", async ({
    page,
  }) => {
    await page.goto("/dashboard/orders");
    await expect(page.locator('tr[data-status="paid"]').first()).toBeVisible();
    await expect(page.locator('tr[data-status="pending"]').first()).toBeVisible();
    expect(await page.locator("tr[data-order-id]").count()).toBeGreaterThanOrEqual(3);
  });
});

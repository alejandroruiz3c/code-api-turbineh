import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ADMIN_STATE = "playwright/.auth/owner.json";

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
      .getByLabel(/^Image/)
      .setInputFiles({ name: "shirt.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("cell", { name: "Linen Shirt" })).toBeVisible();
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

  test.describe("shopper", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("buys with card: checkout, signed payment webhook, order paid, stock and cart updated", async ({
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

      // The hosted Stripe page is outside the sandbox: answer it locally and check we were sent there.
      await page.route("https://checkout.stripe.com/**", (route) =>
        route.fulfill({ body: "Stripe Checkout (simulated)", contentType: "text/plain" }),
      );
      await page.getByLabel(/Email for your receipt/).fill("buyer@example.com");
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL(/checkout\.stripe\.com/);

      const admin = await browser.newContext({ storageState: ADMIN_STATE });
      const adminPage = await admin.newPage();
      await adminPage.goto("/dashboard/orders");
      const row = adminPage.locator('tr[data-status="pending"]').first();
      const orderId = (await row.getAttribute("data-order-id")) ?? "";
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

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
      await admin.close();

      await page.unroute("https://checkout.stripe.com/**");
      await page.goto("/cart");
      await expect(page.getByText("Your cart is empty")).toBeVisible();
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
    });
  });
});

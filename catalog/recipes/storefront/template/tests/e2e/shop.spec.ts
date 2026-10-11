import { expect, test } from "@playwright/test";

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

    test("finds the product, adds it to the cart and sees the total", async ({ page }) => {
      await page.goto("/shop?q=linen");
      await page
        .getByRole("link", { name: /Linen Shirt/ })
        .first()
        .click();
      await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();
      await expect(page.getByTestId("price")).toContainText("49.90");
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
      await page.getByLabel("Quantity").fill("2");
      await page.getByRole("button", { name: "Add to cart" }).click();
      await expect(page.getByTestId("cart-total")).toContainText("99.80");
      await page.getByRole("button", { name: "Checkout" }).click();
      await expect(page.getByRole("status")).toContainText("not configured");
    });

    test("rejects webhooks without a valid signature", async ({ request }) => {
      const res = await request.post("/api/stripe/webhook", {
        data: { type: "checkout.session.completed" },
      });
      expect([400, 503]).toContain(res.status());
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

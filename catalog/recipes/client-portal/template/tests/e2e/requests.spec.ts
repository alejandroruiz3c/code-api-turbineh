import { expect, test } from "@playwright/test";

test.describe.serial("client requests", () => {
  test("the owner submits a document request, uploads a PDF file to it and downloads it as an attachment, then updates the request's status", async ({
    page,
  }) => {
    await page.goto("/dashboard/requests");
    await page.getByLabel("Title").fill("Annual accounts review");
    await page.getByLabel("Description").fill("Please review the attached statement.");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByRole("heading", { name: "Annual accounts review" })).toBeVisible();

    await page.getByLabel(/File \(PDF/).setInputFiles({
      name: "statement.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% test statement\n"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    const link = page.getByRole("link", { name: "statement.pdf" });
    await expect(link).toBeVisible();
    const res = await page.request.get((await link.getAttribute("href")) ?? "");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");

    await page.getByLabel("Move to").selectOption("in_review");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByTestId("request-status")).toHaveText("In review");
  });

  test("an HTML file disguised as a PDF is rejected", async ({ page }) => {
    await page.goto("/dashboard/requests");
    await page.getByRole("link", { name: "Annual accounts review" }).click();
    await page.getByLabel(/File \(PDF/).setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("link", { name: "invoice.pdf" })).toHaveCount(0);
  });
});

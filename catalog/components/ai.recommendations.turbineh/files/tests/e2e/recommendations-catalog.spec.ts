import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signUpOrSignIn } from "./helpers";

/**
 * Staff catalogue of the recommendation component (ai.recommendations.turbineh): records are created and verified by
 * staff (ADMIN_EMAILS); only verified ones are ever published. The default E2E owner is staff.
 */
const params = JSON.parse(
  readFileSync(join(process.cwd(), "src/recommendations/params.json"), "utf8"),
) as {
  currency: string;
  fields: { key: string; label: string; type: string; options?: string[] }[];
};
const run = String(Date.now()).slice(-6);

test("staff add records to the catalogue and mark them verified; only verified records are published", async ({
  page,
}) => {
  const refs = [`CT-${run}1`, `CT-${run}2`];
  for (const [i, reference] of refs.entries()) {
    await page.goto("/dashboard/catalog");
    const form = page.locator("form", { has: page.getByRole("button", { name: "Save" }) });
    await form.getByLabel("Reference").fill(reference);
    await form.getByLabel("Title").fill(`Catalogue test ${i + 1}`);
    await form.getByLabel(/^Price/).fill(String(200_000 + i * 10_000));
    await form.getByLabel("Location").fill("Test Harbour");
    for (const f of params.fields) {
      const input = form.getByLabel(f.label, { exact: true });
      if (f.type === "enum") await input.selectOption(f.options?.[0] ?? "");
      else await input.fill(f.type === "text" ? "standard" : "2");
    }
    if (i === 0) await form.getByLabel(/verified/).check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText(`Saved ${reference}`);
  }
  await page.goto("/dashboard/catalog");
  await expect(page.locator(`tr[data-reference="${refs[0]}"]`)).toContainText("verified");
  await expect(page.locator(`tr[data-reference="${refs[1]}"]`)).toContainText("not verified");

  // The unverified record is not published (public comparison page).
  await page.goto(`/compare?refs=${refs.join(",")}`);
  await expect(page.getByText(`Not found: ${refs[1]}`)).toBeVisible();

  // Once staff verify it, it is.
  await page.goto("/dashboard/catalog");
  await page
    .locator(`tr[data-reference="${refs[1]}"]`)
    .getByRole("button", { name: "Mark verified" })
    .click();
  await expect(
    page.locator(`tr[data-reference="${refs[1]}"]`).getByRole("button", { name: "Unverify" }),
  ).toBeVisible();
  await page.goto(`/compare?refs=${refs.join(",")}`);
  const table = page.getByRole("table", { name: "Comparison" });
  await expect(table).toContainText(refs[1]!);
  await expect(table.getByRole("row", { name: /Price/ })).toContainText(
    `210,000 ${params.currency}`,
  );
});

test.describe("staff only", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("people who are not staff cannot manage the catalogue", async ({ page }) => {
    await signUpOrSignIn(page, `visitor-${Date.now()}@example.com`);
    await page.goto("/dashboard/catalog");
    await expect(page.getByRole("status")).toContainText("Only staff");
  });
});

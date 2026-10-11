import { expect, test } from "@playwright/test";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test.describe.serial("bookings", () => {
  test("the owner opens every day from 08:00 to 20:00 (UTC)", async ({ page }) => {
    await page.goto("/dashboard/availability");
    for (const d of [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]) {
      await page.getByLabel(d).check();
    }
    await page.getByLabel("From").fill("08:00");
    await page.getByLabel("To").fill("20:00");
    await page.getByRole("button", { name: "Add hours" }).click();
    await expect(page.getByRole("cell", { name: "08:00" }).first()).toBeVisible();
  });

  test("the owner books a slot and sees it in the calendar", async ({ page }) => {
    await page.goto("/dashboard/bookings");
    await page.getByLabel("Customer name").fill("Grace Client");
    await page.getByLabel("Customer email").fill("grace@example.com");
    await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);
    await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);
    await page.getByRole("button", { name: "Book" }).click();
    await expect(page.getByRole("status")).toContainText("Booking confirmed");
    await page.goto("/dashboard/calendar");
    await expect(page.getByText("Grace Client")).toBeVisible();
  });

  test("an overlapping booking is rejected", async ({ page }) => {
    await page.goto("/dashboard/bookings");
    await page.getByLabel("Customer name").fill("Overlap Client");
    await page.getByLabel("Customer email").fill("overlap@example.com");
    await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:15`);
    await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:45`);
    await page.getByRole("button", { name: "Book" }).click();
    await expect(page.getByRole("status")).toContainText("already booked");
  });

  test("a booking outside the opening hours is rejected", async ({ page }) => {
    await page.goto("/dashboard/bookings");
    await page.getByLabel("Customer name").fill("Night Client");
    await page.getByLabel("Customer email").fill("night@example.com");
    await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T21:00`);
    await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T21:30`);
    await page.getByRole("button", { name: "Book" }).click();
    await expect(page.getByRole("status")).toContainText("outside the availability");
  });
});

import type { Page } from "@playwright/test";

/**
 * Submits the public booking form (extension point of the E2E suite): no payment step by default. A component that
 * adds one (payments.booking-deposit.turbineh) replaces this file so the same booking tests also pay, offline.
 */
export async function submitBooking(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Book", exact: true }).click();
}

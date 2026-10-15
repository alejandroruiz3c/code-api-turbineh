/** Extra settings for the E2E run: the shop's tests also cover a second currency (fixed prices, no exchange rates). */
export const TEST_ENV: Record<string, string> = { SHOP_CURRENCIES: "usd" };

import { cookies } from "next/headers";
import { env } from "@/env";
import { pickCurrency, shopCurrencies } from "@/lib/shop";

export const CURRENCY_COOKIE = "shop_currency";

/** Base currency first, then SHOP_CURRENCIES. */
export const enabledCurrencies = (): string[] =>
  shopCurrencies(env.SHOP_CURRENCY, env.SHOP_CURRENCIES);

/** The buyer's currency from its cookie, validated against the enabled list (base currency otherwise). */
export async function currentCurrency(): Promise<string> {
  return pickCurrency((await cookies()).get(CURRENCY_COOKIE)?.value, enabledCurrencies());
}

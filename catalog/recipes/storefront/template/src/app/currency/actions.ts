"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { pickCurrency } from "@/lib/shop";
import { CURRENCY_COOKIE, enabledCurrencies } from "@/server/currency";

/** Same-site paths only ("/shop?q=x"), never "//host" or absolute URLs. */
const back = (v: FormDataEntryValue | null) =>
  typeof v === "string" && /^\/(?![/\\])[\w\-/?=&%.]*$/.test(v) && v.length <= 300 ? v : "/shop";

// Choosing a currency is public by design: the value is checked against the shop's own list and only stored in the
// visitor's cookie; prices always come from the database.
// nosemgrep: turbineh.server-action-without-authz
export async function setCurrency(formData: FormData): Promise<void> {
  const currency = pickCurrency(String(formData.get("currency") ?? ""), enabledCurrencies());
  (await cookies()).set(CURRENCY_COOKIE, currency, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  // Same-site path checked by back().
  // nosemgrep: turbineh.open-redirect
  redirect(back(formData.get("back")));
}

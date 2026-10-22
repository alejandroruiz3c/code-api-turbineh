import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Phone numbers for WhatsApp (component messaging.whatsapp.meta): E.164 ("+34612345678"), validated with
 * libphonenumber-js (data.phone.libphonenumber-js). A number typed without a country code is read in `defaultCountry`
 * when the app has one; otherwise it is refused.
 */
export function whatsappE164(input: string, defaultCountry: string | null = null): string | null {
  const text = input.trim();
  if (!text || text.length > 40) return null;
  const parsed = parsePhoneNumberFromString(
    text,
    defaultCountry ? { defaultCountry: defaultCountry as CountryCode } : undefined,
  );
  return parsed?.isValid() ? parsed.number : null;
}

/** A WhatsApp id from a webhook ("34612345678": the number's digits without "+") as E.164. */
export const waIdToE164 = (waId: string): string | null =>
  /^\d{6,15}$/.test(waId) ? whatsappE164(`+${waId}`) : null;

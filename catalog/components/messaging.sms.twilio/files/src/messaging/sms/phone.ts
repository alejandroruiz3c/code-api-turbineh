import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Phone numbers for SMS (component messaging.sms.twilio): E.164 ("+34612345678"), validated with libphonenumber-js
 * (data.phone.libphonenumber-js) — length and number ranges per country, not just digits. A number typed without a
 * country code is read in `defaultCountry` when the app has one; otherwise it is refused.
 */
export function toE164(input: string, defaultCountry: string | null = null): string | null {
  const text = input.trim();
  if (!text || text.length > 40) return null;
  const parsed = parsePhoneNumberFromString(
    text,
    defaultCountry ? { defaultCountry: defaultCountry as CountryCode } : undefined,
  );
  return parsed?.isValid() ? parsed.number : null;
}

/** "+34 6•• ••• 678": enough for staff to recognise a number, never the whole of it on a screen or in a log. */
export function maskPhone(e164: string): string {
  return e164.length <= 6
    ? "•••"
    : `${e164.slice(0, 4)}${"•".repeat(e164.length - 7)}${e164.slice(-3)}`;
}

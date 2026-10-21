import params from "@/reminders/params.json";

/**
 * Reminder consent on the public booking form (domain.bookings.turbineh with domain.reminders.turbineh): one unticked
 * box per phone channel the business uses. Nothing is sent by SMS or WhatsApp unless the person ticks it.
 */
const LABEL = { sms: "an SMS", whatsapp: "a WhatsApp" } as const;

export function BookingFormExtras() {
  const channels = params.channels.filter(
    (c): c is "sms" | "whatsapp" => c === "sms" || c === "whatsapp",
  );
  if (channels.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium text-muted">Reminders</legend>
      {channels.map((c) => (
        <label key={c} className="flex items-start gap-2">
          <input type="checkbox" name={`${c}Reminders`} className="mt-1" />
          <span>
            Send me {LABEL[c]} reminder {params.hoursBefore} hours before, to the mobile number
            above (with its country code). Reply STOP at any time to stop them.
          </span>
        </label>
      ))}
    </fieldset>
  );
}

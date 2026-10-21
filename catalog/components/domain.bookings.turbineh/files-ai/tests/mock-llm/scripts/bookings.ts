import type { MockScript } from "../mock";

/**
 * Scripted model behaviour for the booking toolkit (component domain.bookings.turbineh): plain-language requests
 * become the same tool calls a real model would make, so E2E tests exercise the real tools, the confirmation step
 * and the database — without internet.
 */
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const TIME = /\b(\d{2}:\d{2})\b/;
// An address, or the placeholder the AI Safety Pack shows the model instead of it ("[email-1]", ADR-0072).
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\[email-\d+\]/;
const REF = /\b([A-Z0-9]{8})\b/;

const pick = (re: RegExp, text: string) => {
  const m = re.exec(text);
  return m?.[1] ?? m?.[0];
};

const script: MockScript = {
  id: "bookings",
  rules: [
    {
      tool: "cancel_appointment",
      when: /\bcancel\b/i,
      args: (t) => {
        const reference = pick(REF, t);
        const email = pick(EMAIL, t);
        return reference && email ? { reference, email } : null;
      },
    },
    {
      tool: "reschedule_appointment",
      when: /\b(move|reschedule|change)\b/i,
      args: (t) => {
        const reference = pick(REF, t.replace(DATE, "").replace(TIME, ""));
        const [email, date, time] = [pick(EMAIL, t), pick(DATE, t), pick(TIME, t)];
        return reference && email && date && time ? { reference, email, date, time } : null;
      },
    },
    {
      tool: "book_appointment",
      when: /\bbook\b/i,
      args: (t) => {
        const [email, date, time] = [pick(EMAIL, t), pick(DATE, t), pick(TIME, t)];
        if (!email || !date || !time) return null;
        const name = /\bfor ([^,<]+?)\s*,/i.exec(t)?.[1]?.trim() ?? "Guest";
        const resource = /\bwith ([^,]+?) for\b/i.exec(t)?.[1]?.trim();
        return { date, time, name, email, ...(resource ? { resource } : {}) };
      },
    },
    {
      tool: "find_appointments",
      when: /\bmy (appointments|bookings)\b/i,
      args: (t) => {
        const email = pick(EMAIL, t);
        return email ? { email } : null;
      },
    },
    {
      tool: "check_availability",
      when: /\b(availab\w*|free|slots?|times?)\b/i,
      args: (t) => {
        const date = pick(DATE, t);
        return date ? { date } : null;
      },
    },
    {
      tool: "business_info",
      when: /\b(price|prices|cost|address|bring|hours|open|team|policy)\b/i,
      args: () => ({}),
    },
  ],
  render: {
    check_availability: (r) => {
      const slots = (r.slots ?? []) as { time: string; resource: string }[];
      if (slots.length === 0) return `No free times on ${String(r.date)}.`;
      return `Free times on ${String(r.date)}:\n${slots
        .slice(0, 8)
        .map((s) => `- ${String(r.date)} ${s.time} with ${s.resource}`)
        .join("\n")}`;
    },
    business_info: (r) => {
      const services = (r.services ?? []) as { name: string; price: string }[];
      const answers = (r.answers ?? []) as { topic: string; answer: string }[];
      return [
        `Prices: ${services.map((s) => `${s.name} ${s.price}`).join(", ")}.`,
        `Opening hours: ${String(r.openingHours)}.`,
        ...answers.map((a) => `${a.topic}: ${a.answer}`),
      ].join("\n");
    },
  },
};

export default script;

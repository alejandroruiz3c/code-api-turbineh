import { z } from "zod";
import { defineTool, ToolError, type Toolkit } from "@/lib/ai/agent";
import { bookingConfig as cfg, hoursText, priceLabel } from "./config";
import {
  availability,
  cancelAppointment,
  checkSlot,
  createAppointment,
  describeOwn,
  faqEntries,
  listResources,
  moveAppointment,
  PolicyError,
  upcomingByEmail,
} from "./service";
import { describeLocal } from "./time";

/**
 * The booking domain as tools for runAgent (component domain.bookings.turbineh, ADR-0032). Read tools answer from
 * real data; create/move/cancel are irreversible: `prepare` checks the slot and the policy and describes exactly
 * what will happen, and the person confirms before `execute` runs.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`Local date YYYY-MM-DD (${cfg.timeZone})`);
const time = z.string().regex(/^\d{2}:\d{2}$/).describe(`Local start time HH:MM (${cfg.timeZone})`);
const email = z.email().max(320).describe(`The ${cfg.customer.singular}'s email address`);
const reference = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{6,12}$/)
  .describe("Booking reference from the confirmation");
const resource = z
  .string()
  .trim()
  .max(80)
  .optional()
  .describe(`${cfg.resource.singular} name, or "any"`);
const service = z
  .string()
  .trim()
  .max(80)
  .optional()
  .describe(`One of: ${cfg.services.map((s) => s.name).join(", ")}`);

/** Domain refusals become ToolError (safe to show); anything else stays an internal error. */
async function domain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PolicyError) throw new ToolError(err.message);
    throw err;
  }
}

const businessInfo = defineTool({
  name: "business_info",
  description: `Facts about ${cfg.business}: opening hours, services, durations and prices, the team, the change/cancellation policy and answers to common questions. Use it for any such question.`,
  parameters: z.object({}).strict(),
  execute: async () => {
    const [team, faq] = await Promise.all([listResources(), faqEntries()]);
    return {
      business: cfg.business,
      timeZone: cfg.timeZone,
      openingHours: hoursText(),
      services: cfg.services.map((s) => ({
        name: s.name,
        minutes: s.minutes,
        price: priceLabel(s) ?? "not published",
      })),
      team: team.map((r) => r.name),
      policy: `Changes and cancellations up to ${cfg.policy.cancelNoticeHours} hours before the appointment.`,
      answers: faq.map((f) => ({
        topic: f.topic,
        answer: f.answer ?? "Not published yet: please ask the team directly.",
      })),
    };
  },
});

const checkAvailability = defineTool({
  name: "check_availability",
  description: `Real free times on a date, optionally for one ${cfg.resource.singular.toLowerCase()} and service. Never offer a time that this tool did not return.`,
  parameters: z.object({ date: day, resource, service }).strict(),
  execute: (a, ctx) =>
    domain(async () => {
      const r = await availability({
        day: a.date,
        resource: a.resource,
        service: a.service,
        now: ctx.now,
      });
      return {
        date: r.day,
        timeZone: r.timeZone,
        service: r.service.name,
        minutes: r.service.minutes,
        slots: r.slots.slice(0, 60).map((s) => ({ time: s.time, resource: s.resource })),
        message: r.slots.length ? undefined : "No free times that day.",
      };
    }),
});

const bookAppointment = defineTool({
  name: "book_appointment",
  description: `Book an appointment for the ${cfg.customer.singular} on a free time returned by check_availability. The person confirms the summary before it is booked; a confirmation email is sent.`,
  parameters: z
    .object({
      date: day,
      time,
      resource,
      service,
      name: z.string().trim().min(2).max(120).describe(`The ${cfg.customer.singular}'s full name`),
      email,
    })
    .strict(),
  irreversible: true,
  prepare: (a, ctx) =>
    domain(async () => {
      const slot = await checkSlot({ day: a.date, time: a.time, resource: a.resource, service: a.service, email: a.email }, ctx.now);
      const price = priceLabel(slot.service);
      return {
        // The confirmed booking is exactly the one described (resource and service resolved now).
        args: { ...a, resource: slot.resource.name, service: slot.service.name },
        summary: `Book ${slot.service.name} (${slot.service.minutes} min${price ? `, ${price}` : ""}) with ${slot.resource.name} on ${describeLocal(slot.start, cfg.timeZone)} (${cfg.timeZone}) for ${a.name} <${a.email}>.`,
      };
    }),
  execute: (a, ctx) =>
    domain(async () => {
      const b = await createAppointment(
        { day: a.date, time: a.time, resource: a.resource, service: a.service, name: a.name, email: a.email, via: "assistant" },
        ctx.now,
      );
      return {
        booked: true,
        reference: b.reference,
        when: b.when,
        resource: b.resource,
        service: b.service,
        price: b.price,
        confirmationEmail: b.emailTransport === "log" ? "logged (no email provider configured)" : "sent",
        message: `Booked: ${b.service} with ${b.resource} on ${b.when}. Reference ${b.reference}. A confirmation email was sent to ${b.email}.`,
      };
    }),
});

const findAppointments = defineTool({
  name: "find_appointments",
  description: "Upcoming appointments booked with an email address (references are only in the confirmation email).",
  parameters: z.object({ email }).strict(),
  execute: (a, ctx) =>
    domain(async () => {
      const list = await upcomingByEmail(a.email, ctx.now);
      return {
        appointments: list,
        message: list.length
          ? `Upcoming: ${list.map((x) => `${x.service} with ${x.resource} on ${x.when}`).join("; ")}.`
          : "No upcoming appointments for that email.",
      };
    }),
});

const rescheduleAppointment = defineTool({
  name: "reschedule_appointment",
  description: `Move an appointment (reference + email) to another free time. Allowed up to ${cfg.policy.cancelNoticeHours} hours before it starts; the person confirms first.`,
  parameters: z.object({ reference, email, date: day, time, resource }).strict(),
  irreversible: true,
  prepare: (a, ctx) =>
    domain(async () => {
      const own = await describeOwn(a.reference, a.email, { now: ctx.now, action: "change" });
      const slot = await checkSlot(
        { day: a.date, time: a.time, resource: a.resource ?? own.resource, service: own.service },
        ctx.now,
        own.id,
      );
      return {
        args: { ...a, resource: slot.resource.name },
        summary: `Move booking ${own.reference} (${own.service} with ${own.resource} on ${own.when}) to ${describeLocal(slot.start, cfg.timeZone)} (${cfg.timeZone}) with ${slot.resource.name}.`,
      };
    }),
  execute: (a, ctx) =>
    domain(async () => {
      const m = await moveAppointment(a.reference, a.email, { day: a.date, time: a.time, resource: a.resource }, { now: ctx.now });
      return { ...m, message: `Moved booking ${m.reference} to ${m.when} with ${m.resource}. We emailed the new details.` };
    }),
});

const cancelTool = defineTool({
  name: "cancel_appointment",
  description: `Cancel an appointment (reference + email). Allowed up to ${cfg.policy.cancelNoticeHours} hours before it starts; the person confirms first.`,
  parameters: z.object({ reference, email }).strict(),
  irreversible: true,
  prepare: (a, ctx) =>
    domain(async () => {
      const own = await describeOwn(a.reference, a.email, { now: ctx.now, action: "cancel" });
      return { summary: `Cancel booking ${own.reference}: ${own.service} with ${own.resource} on ${own.when}.` };
    }),
  execute: (a, ctx) =>
    domain(async () => {
      const c = await cancelAppointment(a.reference, a.email, { now: ctx.now });
      return { ...c, message: `Cancelled booking ${c.reference} (${c.when}). We emailed a confirmation.` };
    }),
});

export const toolkit: Toolkit = {
  id: "bookings",
  title: `${cfg.business} assistant`,
  audience: "public",
  greeting: `Hi! I can check availability, book, move or cancel appointments at ${cfg.business}, and answer common questions.`,
  instructions: [
    `You are the booking assistant of ${cfg.business}. ${cfg.customer.plural[0]?.toUpperCase() ?? ""}${cfg.customer.plural.slice(1)} talk to you in plain language.`,
    `All dates and times are local to ${cfg.timeZone}. Use business_info for hours, services, prices, the team and common questions; use check_availability before proposing any time.`,
    "To book you need the date, time, the person's full name and email (and optionally who they prefer). To move or cancel you need the booking reference and email.",
    "If something is not published (e.g. an answer marked 'Not published yet'), say so; never make it up. Do not give medical, legal or financial advice.",
  ].join("\n"),
  tools: [businessInfo, checkAvailability, bookAppointment, findAppointments, rescheduleAppointment, cancelTool],
};

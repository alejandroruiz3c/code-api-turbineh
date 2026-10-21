import { desc } from "drizzle-orm";
import { z } from "zod";
import { defineTool, ToolError, type AnyAgentTool } from "@/lib/ai/agent";
import { bookingConfig } from "@/bookings/config";
import { checkSlot, createAppointment, PolicyError } from "@/bookings/service";
import { describeLocal } from "@/bookings/time";
import { db } from "@/db/client";
import { recommendationViewings } from "@/db/schema";
import { recommendationConfig as cfg } from "./config";
import { referenceSchema } from "./search";
import { publishedByReference } from "./store";

/**
 * Viewings of a catalogue record through the booking domain (ai.recommendations.turbineh with domain.bookings.turbineh):
 * `book_viewing` is irreversible — `prepare` checks that the record is published and that the time is really free
 * (the bookings rules: opening hours, notice, no double booking) and describes exactly what will be booked; the
 * person confirms before `execute` creates the booking (confirmation email included) and links it to the record.
 */
export const VIEWINGS_ENABLED = true;

const viewingArgs = z
  .object({
    reference: referenceSchema.describe(`Reference of the ${cfg.item.singular} to view`),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe(`Local date YYYY-MM-DD (${bookingConfig.timeZone})`),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe(`Local start time HH:MM (${bookingConfig.timeZone})`),
    name: z.string().trim().min(2).max(120).describe("The person's full name"),
    email: z.email().max(320).describe("The person's email address"),
    resource: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe("Who shows it (resolved when checking the time)"),
  })
  .strict();

async function published(reference: string) {
  const { items } = await publishedByReference([reference]);
  const item = items[0];
  if (!item)
    throw new ToolError(`No published ${cfg.item.singular} has the reference ${reference}.`);
  return item;
}

async function domain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PolicyError) throw new ToolError(err.message);
    throw err;
  }
}

const bookViewing = defineTool({
  name: "book_viewing",
  description: `Book a viewing of one ${cfg.item.singular} (by reference) on a free time returned by check_availability. The person confirms the summary before it is booked; a confirmation email is sent.`,
  parameters: viewingArgs,
  irreversible: true,
  prepare: async (a, ctx) => {
    const item = await published(a.reference);
    const slot = await domain(() =>
      checkSlot({ day: a.date, time: a.time, resource: a.resource, email: a.email }, ctx.now),
    );
    return {
      // The confirmed booking is exactly the one described: the same team member.
      args: { ...a, resource: slot.resource.name },
      summary: `Book a viewing of ${item.reference} (${item.title}, ${item.location}) on ${describeLocal(slot.start, bookingConfig.timeZone)} (${bookingConfig.timeZone}) with ${slot.resource.name} for ${a.name} <${a.email}>.`,
    };
  },
  execute: async (a, ctx) => {
    const item = await published(a.reference);
    const b = await domain(() =>
      createAppointment(
        {
          day: a.date,
          time: a.time,
          resource: a.resource,
          name: a.name,
          email: a.email,
          via: "assistant",
        },
        ctx.now,
      ),
    );
    await db.insert(recommendationViewings).values({
      appointmentReference: b.reference,
      itemReference: item.reference,
      conversation: ctx.userId.slice(0, 120),
      when: b.when.slice(0, 120),
      customerEmail: b.email,
    });
    return {
      booked: true,
      reference: b.reference,
      item: item.reference,
      when: b.when,
      message: `Viewing booked: ${item.reference} (${item.title}) on ${b.when} with ${b.resource}. Booking reference ${b.reference}. A confirmation email was sent to ${b.email}.`,
    };
  },
});

export const VIEWING_TOOLS: AnyAgentTool[] = [bookViewing];

/** Staff list: the viewings the assistant booked, newest first, with the record each one is for. */
export async function viewingsByItem(): Promise<
  { item: string; appointment: string; when: string; customer: string }[]
> {
  const rows = await db
    .select()
    .from(recommendationViewings)
    .orderBy(desc(recommendationViewings.createdAt))
    .limit(200);
  return rows.map((r) => ({
    item: r.itemReference,
    appointment: r.appointmentReference,
    when: r.when,
    customer: r.customerEmail,
  }));
}

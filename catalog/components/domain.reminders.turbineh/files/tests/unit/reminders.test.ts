import { describe, expect, it } from "vitest";
import { ReminderParams, reminderConfig } from "@/reminders/config";
import {
  dueAt,
  emailReminder,
  isDue,
  retryDelayMs,
  smsReminder,
  whatsappReminderParams,
  whenText,
} from "@/reminders/schedule";

/** Contract of domain.reminders.turbineh: when a reminder is due, what it says, and how failures are retried. */
const H = 3_600_000;
const facts = {
  reference: "AB12CD34",
  customerName: "Lucía",
  service: "Physiotherapy session",
  resource: "Marta",
  business: "Flex Physio",
  timeZone: "Europe/Madrid",
  // Sunday 25 October 2026 10:00 in Madrid, the day daylight saving time ends (CET, UTC+1).
  startsAt: new Date("2026-10-25T09:00:00Z"),
};

describe("appointment reminders", () => {
  it("the shipped params are valid; hours, channels and the WhatsApp template are checked", () => {
    expect(reminderConfig.hoursBefore).toBeGreaterThan(0);
    const ok = {
      hoursBefore: 24,
      channels: ["email", "sms"],
      whatsappTemplate: { name: "appointment_reminder", language: "es" },
      maxAttempts: 3,
    };
    expect(ReminderParams.safeParse(ok).success).toBe(true);
    for (const bad of [
      { hoursBefore: 0 },
      { hoursBefore: 24 * 8 },
      { channels: [] },
      { channels: ["email", "email"] },
      { channels: ["fax"] },
      { whatsappTemplate: { name: "Appointment Reminder", language: "es" } },
    ])
      expect(ReminderParams.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });

  it("a reminder is due the set number of real hours before the appointment, across daylight saving, and shows the local time in the business's time zone", () => {
    // 24 real hours before Sunday 10:00 CET is Saturday 09:00 UTC = 11:00 CEST (summer time still on).
    expect(dueAt(facts.startsAt, 24).toISOString()).toBe("2026-10-24T09:00:00.000Z");
    expect(whenText(facts)).toBe("Sunday 2026-10-25 10:00 (Europe/Madrid)");
    const created = new Date("2026-10-01T10:00:00Z");
    expect(
      isDue({ startsAt: facts.startsAt, createdAt: created }, 24, new Date("2026-10-24T08:59:00Z")),
    ).toBe(false);
    expect(
      isDue({ startsAt: facts.startsAt, createdAt: created }, 24, new Date("2026-10-24T09:00:00Z")),
    ).toBe(true);
    expect(
      isDue({ startsAt: facts.startsAt, createdAt: created }, 24, new Date("2026-10-25T08:59:00Z")),
    ).toBe(true);
    // Once the appointment has started it is too late.
    expect(isDue({ startsAt: facts.startsAt, createdAt: created }, 24, facts.startsAt)).toBe(false);
  });

  it("an appointment booked after its reminder time gets no reminder (its confirmation was just sent)", () => {
    const now = new Date("2026-10-24T20:00:00Z");
    expect(
      isDue({ startsAt: facts.startsAt, createdAt: new Date("2026-10-24T19:30:00Z") }, 24, now),
    ).toBe(false);
    expect(
      isDue({ startsAt: facts.startsAt, createdAt: new Date("2026-10-20T19:30:00Z") }, 24, now),
    ).toBe(true);
  });

  it("each channel's reminder names the service, the team member, the local date and time and the reference; SMS says how to stop", () => {
    const mail = emailReminder(facts, 24);
    expect(mail.subject).toBe(
      "Flex Physio: reminder of your Physiotherapy session on Sunday 2026-10-25 10:00",
    );
    expect(mail.text).toContain("with Marta on Sunday 2026-10-25 10:00 (Europe/Madrid)");
    expect(mail.text).toContain("AB12CD34");
    const sms = smsReminder(facts);
    expect(sms).toContain("Sunday 2026-10-25 10:00 (Europe/Madrid)");
    expect(sms).toMatch(/Reply STOP to opt out\.$/);
    expect(sms.length).toBeLessThanOrEqual(1600);
    expect(whatsappReminderParams(facts)).toEqual([
      "Lucía",
      "Physiotherapy session",
      "Sunday 2026-10-25 10:00 (Europe/Madrid)",
      "Flex Physio",
    ]);
  });

  it("failed reminders are retried on later runs with exponential backoff and jitter, never sooner than the provider asked", () => {
    expect(retryDelayMs(1, null, () => 1)).toBe(60_000);
    expect(retryDelayMs(1, null, () => 0)).toBe(30_000);
    expect(retryDelayMs(3, null, () => 1)).toBe(240_000);
    expect(retryDelayMs(20, null, () => 1)).toBe(H);
    expect(retryDelayMs(1, 5 * 60_000, () => 1)).toBe(5 * 60_000);
  });
});

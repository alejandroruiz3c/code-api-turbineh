import { describe, expect, it } from "vitest";
import { detectDomains } from "./domains.js";
import { extractMailTriageParams, isMailTriage, mailJobs } from "./domains-mail.js";

// Synthetic requests (ADR-0072): same kind of need as real ones, other words and names.
const INBOX =
  "Set up agents that read my inbox, label each message I get by urgency and every morning at 8:30 send me a " +
  "summary email of what I have to reply to. Bills and payments should go into an Excel sheet of my income, expenses " +
  "and investments, in euros, Europe/Lisbon time.";
const zones = { isTimeZone: (tz: string) => /^[A-Z][a-z]+\/[A-Z][a-z]+$/.test(tz), cities: {} };

describe("mailbox triage domain (ai.mail-triage.turbineh)", () => {
  it("detects a mailbox triage with its schedule, currency and time zone from the request", () => {
    const d = extractMailTriageParams(INBOX, zones);
    expect(d?.params).toMatchObject({
      finance: {
        enabled: true,
        kinds: ["income", "expense", "investment"],
        defaultCurrency: "EUR",
      },
      digest: { enabled: true, at: "08:30", timeZone: "Europe/Lisbon", minPriority: "high" },
    });
    expect(mailJobs(d!.params)).toMatchObject({
      jobs: [
        { id: "mail-sync", kind: "custom", cron: "*/15 * * * *" },
        { id: "mail-digest", kind: "daily-digest", cron: "30 8 * * *", timeZone: "Europe/Lisbon" },
      ],
    });
    const components = detectDomains(INBOX, "ai-agents").map((x) => x.component);
    expect(components).toEqual(["ai.mail-triage.turbineh", "jobs.scheduled.turbineh"]);
  });

  it("states its defaults when the request does not say them", () => {
    const d = extractMailTriageParams(
      "An assistant that triages the emails I receive by priority",
      zones,
    );
    expect(d?.params.digest).toMatchObject({ at: "07:00", timeZone: "UTC" });
    expect(d?.params.finance.enabled).toBe(false);
    expect(d?.assumptions.join(" ")).toContain("read-only");
  });

  it("is not a mailbox triage for apps that only send email, and only the ai-agents recipe hosts it", () => {
    expect(
      isMailTriage("Customers book online and receive a confirmation email; staff take payments"),
    ).toBe(false);
    expect(isMailTriage("A newsletter tool that sends a weekly email to subscribers")).toBe(false);
    expect(detectDomains(INBOX, "saas-crud")).toEqual([]);
  });
});

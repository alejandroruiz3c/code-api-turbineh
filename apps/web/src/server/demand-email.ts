import { sendDemandEmails, type BuildRow } from "@turbineh/db";
import { createLogger, mailerFromEnv } from "@turbineh/shared";
import { after } from "next/server";
import { db } from "./db";

const log = createLogger("demand-email");

/** True when the scope gate refused the flow, fully or in part (ADR-0052): there is a demand row to confirm. */
export function isRefusedDemand(row: Pick<BuildRow, "metrics">): boolean {
  const status = (row.metrics.scopeGate as { status?: string } | undefined)?.status;
  return status === "uncovered" || status === "partial";
}

/**
 * ADR-0056: once a refused flow is seen, send the priority-list confirmation and the owner alert after the response
 * (`after()`), once per demand row. Never blocks or fails the request; without RESEND_API_KEY it does nothing (one
 * warning per instance).
 */
export function confirmDemandLater(row: Pick<BuildRow, "id" | "metrics">): void {
  if (!isRefusedDemand(row) || handled.has(row.id)) return;
  const mailer = mailerFromEnv();
  if (!mailer) return;
  after(async () => {
    const r = await sendDemandEmails(db, mailer, row.id, log);
    // Polls of the same flow stop touching the database once this instance has sent its emails.
    if (r.confirmation !== "failed" && r.ownerAlert === "sent") remember(row.id);
  });
}

/**
 * ADR-0074: the person just gave an email for a refused flow ("Notify me when it's covered"): its priority-list
 * confirmation is sent after the response, whatever the age of the request (still once per row).
 */
export function confirmDemandNow(buildId: string): "scheduled" | "email_disabled" {
  const mailer = mailerFromEnv();
  if (!mailer) return "email_disabled";
  after(async () => {
    await sendDemandEmails(db, mailer, buildId, log, { anyAge: true });
  });
  return "scheduled";
}

/** Flows already handled by this instance (bounded). */
const handled = new Set<string>();
function remember(id: string): void {
  if (handled.size >= 5000) handled.clear();
  handled.add(id);
}

import { escapeHtml, isEmailAddress, type Logger, type Mailer } from "@turbineh/shared";
import type pg from "pg";

/**
 * Demand emails (ADR-0056, ADR-0052 §4). For each request the scope gate refuses (or covers only in part):
 *  - the person who asked gets one confirmation that they are on the priority list, with what is not covered yet;
 *  - the owner gets one short alert (`DEMAND_ALERT_EMAIL`).
 * Later, the owner tells people a capability is available (`notifyAvailable`, `pnpm --filter @turbineh/db
 * notify-available`). Every send is claimed in the database first, so a row is emailed once; failures are logged
 * without personal data and never reach the API response.
 */
type Db = Pick<pg.Pool, "query">;
type Missing = { requirement: string; why: string }[];

/** Rows older than this are never confirmed (a refused flow re-opened days later does not email). */
const CONFIRM_WINDOW = "2 days";
/** A send that keeps failing (invalid address, provider down) is given up after this many attempts. */
export const MAX_EMAIL_ATTEMPTS = 3;

interface ClaimedRow {
  id: number;
  email: string | null;
  owner_id: string | null;
  request: string;
  status: "uncovered" | "partial";
  use_case: string | null;
  missing: Missing;
}

export interface Email {
  subject: string;
  html: string;
  text: string;
}

const shell = (body: string) =>
  `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">${body}<p style="color:#666;font-size:13px;margin-top:32px">TurbineH · YES IF for Builders</p></body></html>`;

const listHtml = (missing: Missing) =>
  missing.length
    ? `<ul>${missing
        .slice(0, 20)
        .map(
          (m) =>
            `<li>${escapeHtml(m.requirement)}${m.why ? ` <span style="color:#666">(${escapeHtml(m.why)})</span>` : ""}</li>`,
        )
        .join("")}</ul>`
    : "";
const listText = (missing: Missing) =>
  missing
    .slice(0, 20)
    .map((m) => `- ${m.requirement}${m.why ? ` (${m.why})` : ""}`)
    .join("\n");
const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/** "You're on the priority list" — to the person whose request was refused. */
export function confirmationEmail(
  row: Pick<ClaimedRow, "request" | "status" | "missing">,
  appUrl: string,
): Email {
  const partial = row.status === "partial";
  const lead = partial
    ? "Part of your request isn't covered by the TurbineH library yet."
    : "We don't cover this use case yet.";
  const promise = "You're on the priority list and we'll email you as soon as it's available.";
  const request = clip(row.request, 400);
  return {
    subject: "You're on the TurbineH priority list",
    text: [
      lead,
      promise,
      "",
      `Your request: "${request}"`,
      ...(row.missing.length ? ["", "Not covered yet:", listText(row.missing)] : []),
      "",
      "TurbineH only builds what its verified components cover, so nothing was generated for the uncovered part.",
      `You can keep building what is covered at ${appUrl}.`,
      "",
      "TurbineH · YES IF for Builders",
    ].join("\n"),
    html: shell(
      `<p><strong>${escapeHtml(lead)}</strong> ${escapeHtml(promise)}</p>` +
        `<p style="color:#444">Your request: “${escapeHtml(request)}”</p>` +
        (row.missing.length ? `<p>Not covered yet:</p>${listHtml(row.missing)}` : "") +
        `<p>TurbineH only builds what its verified components cover, so nothing was generated for the uncovered part. ` +
        `You can keep building what is covered at <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a>.</p>`,
    ),
  };
}

/** Short alert to the owner: one per uncovered (or partial) request. */
export function ownerAlertEmail(row: ClaimedRow): Email {
  const who = `${row.owner_id ?? "anonymous"} · ${row.email ?? "no email"}`;
  const request = clip(row.request, 600);
  return {
    subject: `Demand #${row.id}: ${row.status === "partial" ? "partially covered" : "uncovered"} request`,
    text: [
      `Demand #${row.id} · ${row.status} · use case: ${row.use_case ?? "none"}`,
      `From: ${who}`,
      `Request: ${request}`,
      ...(row.missing.length ? ["Missing:", listText(row.missing)] : []),
      "",
      "Full list: pnpm --filter @turbineh/db demand",
    ].join("\n"),
    html: shell(
      `<p><strong>Demand #${row.id}</strong> · ${escapeHtml(row.status)} · use case: ${escapeHtml(row.use_case ?? "none")}</p>` +
        `<p>From: ${escapeHtml(who)}</p><p>Request: ${escapeHtml(request)}</p>` +
        (row.missing.length ? `<p>Missing:</p>${listHtml(row.missing)}` : "") +
        `<p style="color:#666">Full list: <code>pnpm --filter @turbineh/db demand</code></p>`,
    ),
  };
}

/** "It's available now" — one per person, listing the requests it answers. */
export function availableEmail(requests: string[], appUrl: string, message?: string): Email {
  const items = requests.slice(0, 10).map((r) => clip(r, 300));
  return {
    subject: "Now available on TurbineH: what you asked for",
    text: [
      "Good news: the TurbineH library now covers what you asked for.",
      ...(message ? ["", message] : []),
      "",
      items.length > 1 ? "Your requests:" : "Your request:",
      ...items.map((r) => `- ${r}`),
      "",
      `Try it again at ${appUrl}.`,
      "",
      "TurbineH · YES IF for Builders",
    ].join("\n"),
    html: shell(
      `<p><strong>Good news: the TurbineH library now covers what you asked for.</strong></p>` +
        (message ? `<p>${escapeHtml(message)}</p>` : "") +
        `<p>${items.length > 1 ? "Your requests:" : "Your request:"}</p><ul>${items.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` +
        `<p>Try it again at <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a>.</p>`,
    ),
  };
}

type Kind = "confirmation" | "owner_alert";
const COLUMNS: Record<Kind, { sent: string; attempts: string }> = {
  confirmation: { sent: "confirmation_sent_at", attempts: "confirmation_attempts" },
  owner_alert: { sent: "owner_alerted_at", attempts: "owner_alert_attempts" },
};

/** Atomically marks the build's demand row as being sent (or returns null when it was already sent/claimed). */
async function claim(
  db: Db,
  buildId: string,
  kind: Kind,
  anyAge = false,
): Promise<ClaimedRow | null> {
  const c = COLUMNS[kind];
  const res = await db.query<ClaimedRow>(
    `UPDATE use_case_demand d SET ${c.sent} = now(), ${c.attempts} = d.${c.attempts} + 1
     WHERE d.build_id = $1 AND d.${c.sent} IS NULL AND d.${c.attempts} < $2
       AND (${anyAge ? "true" : "false"} OR d.created_at > now() - interval '${CONFIRM_WINDOW}')${
         kind === "confirmation"
           ? `
       AND coalesce(d.email, (SELECT p.email FROM priority_notifications p WHERE p.owner_id = d.owner_id)) IS NOT NULL`
           : ""
       }
     RETURNING d.id::integer AS id, coalesce(d.email, (SELECT p.email FROM priority_notifications p WHERE p.owner_id = d.owner_id)) AS email,
               d.owner_id, d.request, d.status, d.use_case, d.missing`,
    [buildId, MAX_EMAIL_ATTEMPTS],
  );
  return res.rows[0] ?? null;
}

async function release(db: Db, id: number, kind: Kind): Promise<void> {
  await db.query(`UPDATE use_case_demand SET ${COLUMNS[kind].sent} = NULL WHERE id = $1`, [id]);
}

export interface DemandEmailResult {
  confirmation: "sent" | "failed" | "no_email" | "skipped";
  ownerAlert: "sent" | "failed" | "skipped";
}

/**
 * Sends the priority-list confirmation and the owner alert for one flow's demand row, once each. Safe to call from
 * several places (worker, web polls): only the caller that claims the row sends. Never throws.
 */
export async function sendDemandEmails(
  db: Db,
  mailer: Mailer | null,
  buildId: string,
  log?: Logger,
  /**
   * ADR-0074: the person just asked to be notified on this flow ("Notify me when it's covered"), so the confirmation
   * is sent even when the request is older than the confirmation window.
   */
  opts: { anyAge?: boolean } = {},
): Promise<DemandEmailResult> {
  const result: DemandEmailResult = { confirmation: "skipped", ownerAlert: "skipped" };
  if (!mailer) return result;
  try {
    const row = await claim(db, buildId, "confirmation", opts.anyAge === true);
    if (row) {
      if (!isEmailAddress(row.email)) {
        // Not a usable address: nothing was sent, and there is nothing to retry.
        result.confirmation = "no_email";
        await db.query(
          `UPDATE use_case_demand SET confirmation_sent_at = NULL, confirmation_attempts = $2 WHERE id = $1`,
          [row.id, MAX_EMAIL_ATTEMPTS],
        );
      } else {
        const sent = await mailer.send({
          to: row.email,
          ...confirmationEmail(row, mailer.appUrl),
          idempotencyKey: `demand-confirmation-${row.id}`,
        });
        result.confirmation = sent.ok ? "sent" : "failed";
        if (!sent.ok) {
          log?.error("priority confirmation email failed", {
            demandId: row.id,
            status: sent.status,
            error: sent.error,
          });
          await release(db, row.id, "confirmation");
        }
      }
    }
    const alert = await claim(db, buildId, "owner_alert");
    if (alert && isEmailAddress(mailer.ownerAlertTo)) {
      const sent = await mailer.send({
        to: mailer.ownerAlertTo,
        ...ownerAlertEmail(alert),
        idempotencyKey: `demand-owner-alert-${alert.id}`,
      });
      result.ownerAlert = sent.ok ? "sent" : "failed";
      if (!sent.ok) {
        log?.error("owner demand alert failed", {
          demandId: alert.id,
          status: sent.status,
          error: sent.error,
        });
        await release(db, alert.id, "owner_alert");
      }
    }
  } catch (err) {
    log?.error("demand emails failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
  }
  return result;
}

export interface AvailableTarget {
  /** Demand row ids. */
  ids?: number[];
  /** Matches the use case id exactly, or a missing requirement / its reason (case-insensitive substring). */
  capability?: string;
}

export interface AvailableMatch {
  id: number;
  email: string | null;
  owner_id: string | null;
  request: string;
}

/** Demand rows not yet told "it's available" that match the target. */
export async function findAvailableTargets(
  db: Db,
  target: AvailableTarget,
): Promise<AvailableMatch[]> {
  const ids = target.ids ?? [];
  const cap = target.capability?.trim() || null;
  if (!ids.length && !cap) return [];
  const res = await db.query<AvailableMatch>(
    `SELECT d.id::integer AS id, coalesce(d.email, p.email) AS email, d.owner_id, d.request
     FROM use_case_demand d LEFT JOIN priority_notifications p ON p.owner_id = d.owner_id
     WHERE d.available_notified_at IS NULL
       AND (d.id = ANY($1::bigint[])
            OR ($2::text IS NOT NULL AND (d.use_case = $2 OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements(d.missing) m
                  WHERE m->>'requirement' ILIKE '%' || $2 || '%' OR m->>'why' ILIKE '%' || $2 || '%'))))
     ORDER BY d.id`,
    [ids, cap],
  );
  return res.rows;
}

export interface AvailableResult {
  matched: number;
  emailed: string[];
  failed: number;
  withoutEmail: number[];
}

/**
 * Tells everyone whose request matches that it is available now: one email per address, the matching rows marked
 * `available_notified_at`, and the person's priority subscription closed when nothing of theirs is still pending.
 * Returns the addresses written to (for the owner's terminal only).
 */
export async function notifyAvailable(
  db: Db,
  mailer: Mailer,
  target: AvailableTarget,
  opts: { message?: string; log?: Logger } = {},
): Promise<AvailableResult> {
  const rows = await findAvailableTargets(db, target);
  const result: AvailableResult = {
    matched: rows.length,
    emailed: [],
    failed: 0,
    withoutEmail: [],
  };
  const byEmail = new Map<string, AvailableMatch[]>();
  for (const r of rows) {
    if (!isEmailAddress(r.email)) {
      result.withoutEmail.push(r.id);
      continue;
    }
    const key = r.email.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), r]);
  }
  for (const [email, group] of byEmail) {
    // Claim first: a second run (or a concurrent one) never emails the same rows again.
    const claimed = await db.query<{ id: number }>(
      `UPDATE use_case_demand SET available_notified_at = now()
       WHERE id = ANY($1::bigint[]) AND available_notified_at IS NULL RETURNING id::integer AS id`,
      [group.map((r) => r.id)],
    );
    const ids = new Set(claimed.rows.map((r) => Number(r.id)));
    const mine = group.filter((r) => ids.has(Number(r.id)));
    if (!mine.length) continue;
    const sent = await mailer.send({
      to: email,
      ...availableEmail(
        mine.map((r) => r.request),
        mailer.appUrl,
        opts.message,
      ),
      idempotencyKey: `demand-available-${mine.map((r) => r.id).join("-")}`.slice(0, 256),
    });
    if (!sent.ok) {
      result.failed++;
      opts.log?.error("available notice failed", {
        demandIds: mine.map((r) => r.id),
        status: sent.status,
        error: sent.error,
      });
      await db.query(
        `UPDATE use_case_demand SET available_notified_at = NULL WHERE id = ANY($1::bigint[])`,
        [mine.map((r) => r.id)],
      );
      continue;
    }
    result.emailed.push(email);
    const owners = [...new Set(mine.map((r) => r.owner_id).filter((o): o is string => Boolean(o)))];
    if (owners.length) {
      await db.query(
        `UPDATE priority_notifications p SET notified_at = now()
         WHERE p.owner_id = ANY($1::text[]) AND NOT EXISTS (
           SELECT 1 FROM use_case_demand d WHERE d.owner_id = p.owner_id AND d.available_notified_at IS NULL)`,
        [owners],
      );
    }
  }
  return result;
}

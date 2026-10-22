import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { InboxConfig } from "./config";

/**
 * Reads new messages of the configured mailbox over IMAP (component email.inbox.imapflow, built on imapflow and
 * mailparser). Read-only by construction: the mailbox is opened with EXAMINE and bodies are fetched with BODY.PEEK[],
 * so nothing is marked as read, moved or deleted on the server. Incremental by UID: only messages after the last UID
 * read are fetched; a new UIDVALIDITY (the server renumbered its messages) starts the mailbox again.
 */
export interface InboxMessage {
  uid: number;
  messageId: string | null;
  from: { name: string; address: string } | null;
  to: string[];
  subject: string;
  /** The Date header (null when absent or invalid). */
  date: Date | null;
  /** When the server received it (INTERNALDATE). */
  receivedAt: Date;
  /** Plain text (from the text part, or derived from HTML by mailparser), bounded. */
  text: string;
  /** Attachments as metadata only: their content is untrusted and never kept. */
  attachments: { filename: string | null; contentType: string; size: number }[];
  /** \Seen on the server when it was read (the client never changes it). */
  seen: boolean;
}

export interface FetchResult {
  uidValidity: string;
  /** The mailbox was renumbered since the last synchronisation (or this is the first one). */
  reset: boolean;
  messages: InboxMessage[];
}

/** Largest part of a message read (headers + text come first; larger attachments are cut). */
export const MAX_SOURCE_BYTES = 1_000_000;
/** Text kept per message. */
export const MAX_TEXT_CHARS = 20_000;

/** Parses one RFC 5322 message with mailparser into the stored shape (no attachment content). */
export async function parseMessage(
  uid: number,
  source: Buffer | string,
  meta: { internalDate?: Date | string; flags?: Set<string> } = {},
): Promise<InboxMessage> {
  const parsed = await simpleParser(source, { skipImageLinks: true });
  const first = parsed.from?.value[0];
  const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [])
    .flatMap((a) => a.value)
    .map((a) => (a.address ?? "").toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
  const date = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : null;
  const received = meta.internalDate ? new Date(meta.internalDate) : (date ?? new Date());
  return {
    uid,
    messageId: parsed.messageId?.slice(0, 300) ?? null,
    from: first?.address
      ? {
          name: (first.name ?? "").slice(0, 200),
          address: first.address.toLowerCase().slice(0, 320),
        }
      : null,
    to,
    subject: (parsed.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    date,
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    text: (parsed.text ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT_CHARS),
    attachments: parsed.attachments.slice(0, 50).map((a) => ({
      filename: a.filename?.slice(0, 255) ?? null,
      contentType: a.contentType.slice(0, 120),
      size: a.size,
    })),
    seen: meta.flags?.has("\\Seen") ?? false,
  };
}

/** Opens a client for this mailbox (no logging: credentials and contents never reach the logs). */
export function imapClient(cfg: InboxConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth:
      cfg.auth.kind === "oauth2"
        ? { user: cfg.user, accessToken: cfg.auth.accessToken }
        : { user: cfg.user, pass: cfg.auth.pass },
    tls: { rejectUnauthorized: true },
    logger: false,
    disableAutoIdle: true,
    disableCompression: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/**
 * The messages after `since.lastUid` (oldest first, at most `cfg.maxPerSync`). The first synchronisation, or one after
 * a UIDVALIDITY change, reads only the latest `cfg.maxPerSync` messages: older mail is not imported.
 */
export async function fetchNewMessages(
  cfg: InboxConfig,
  since: { uidValidity: string | null; lastUid: number },
  client: ImapFlow = imapClient(cfg),
): Promise<FetchResult> {
  await client.connect();
  try {
    const box = await client.mailboxOpen(cfg.mailbox, { readOnly: true });
    const uidValidity = String(box.uidValidity);
    const reset = since.uidValidity !== uidValidity;
    const from = reset ? 1 : since.lastUid + 1;
    if (box.exists === 0) return { uidValidity, reset, messages: [] };
    // "n:*" always includes the highest UID, even when it is lower than n: keep only UIDs ≥ n.
    const found = await client.search({ uid: `${from}:*` }, { uid: true });
    const uids = (Array.isArray(found) ? found : []).filter((u) => u >= from).sort((a, b) => a - b);
    const chosen = reset ? uids.slice(-cfg.maxPerSync) : uids.slice(0, cfg.maxPerSync);
    if (chosen.length === 0) return { uidValidity, reset, messages: [] };
    const raw = await client.fetchAll(
      chosen.join(","),
      {
        uid: true,
        flags: true,
        internalDate: true,
        source: { start: 0, maxLength: MAX_SOURCE_BYTES },
      },
      { uid: true },
    );
    const messages: InboxMessage[] = [];
    for (const m of raw.sort((a, b) => a.uid - b.uid)) {
      if (!chosen.includes(m.uid) || !m.source) continue;
      messages.push(await parseMessage(m.uid, m.source, m));
    }
    return { uidValidity, reset, messages };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

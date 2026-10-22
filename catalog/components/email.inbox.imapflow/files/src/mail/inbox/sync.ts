import { inboxConfig, type InboxConfig } from "./config";
import { fetchNewMessages, type FetchResult, type InboxMessage } from "./imap";

/**
 * One synchronisation of the mailbox (component email.inbox.imapflow): reads what arrived after the last UID stored
 * and saves it with the new position in one step, so a failed run never skips or duplicates a message (each message
 * is unique per mailbox, UIDVALIDITY and UID). Storage is an interface: src/mail/inbox/store.ts keeps it in
 * PostgreSQL; tests use memory.
 */
export interface InboxStore {
  position(mailbox: string): Promise<{ uidValidity: string | null; lastUid: number }>;
  /** Saves the messages and the new position atomically; returns how many were new. */
  save(
    mailbox: string,
    uidValidity: string,
    messages: InboxMessage[],
    lastUid: number,
  ): Promise<number>;
}

export interface SyncReport {
  configured: boolean;
  fetched: number;
  stored: number;
  /** The mailbox was read from the start (first run, or UIDVALIDITY changed). */
  reset: boolean;
  lastUid: number;
}

export async function syncInbox(deps: {
  store: InboxStore;
  config?: InboxConfig | null;
  fetch?: (
    cfg: InboxConfig,
    since: { uidValidity: string | null; lastUid: number },
  ) => Promise<FetchResult>;
}): Promise<SyncReport> {
  const cfg = deps.config === undefined ? inboxConfig() : deps.config;
  if (!cfg) return { configured: false, fetched: 0, stored: 0, reset: false, lastUid: 0 };
  const since = await deps.store.position(cfg.mailbox);
  const got = await (deps.fetch ?? fetchNewMessages)(cfg, since);
  const lastUid = Math.max(got.reset ? 0 : since.lastUid, ...got.messages.map((m) => m.uid));
  const stored = await deps.store.save(cfg.mailbox, got.uidValidity, got.messages, lastUid);
  return { configured: true, fetched: got.messages.length, stored, reset: got.reset, lastUid };
}

/** In-memory store (tests, scripts). */
export function memoryStore(): InboxStore & { messages: Map<string, InboxMessage> } {
  const positions = new Map<string, { uidValidity: string | null; lastUid: number }>();
  const messages = new Map<string, InboxMessage>();
  return {
    messages,
    position: async (mailbox) => positions.get(mailbox) ?? { uidValidity: null, lastUid: 0 },
    save: async (mailbox, uidValidity, list, lastUid) => {
      let added = 0;
      for (const m of list) {
        const key = `${mailbox}/${uidValidity}/${m.uid}`;
        if (messages.has(key)) continue;
        messages.set(key, m);
        added++;
      }
      positions.set(mailbox, { uidValidity, lastUid });
      return added;
    },
  };
}

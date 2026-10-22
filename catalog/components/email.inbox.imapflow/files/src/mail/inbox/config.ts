import { z } from "zod";

/**
 * Mailbox connection (component email.inbox.imapflow): one IMAP mailbox per app, configured only by environment
 * variables (never stored in the database, never logged). Sign-in with an app password (MAIL_IMAP_PASSWORD) or an
 * OAuth 2.0 access token (MAIL_IMAP_ACCESS_TOKEN, SASL XOAUTH2 — Gmail, Microsoft 365). TLS is required: a plain
 * connection is accepted only to a server on this machine (127.0.0.1, ::1, localhost), e.g. a local test server.
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  MAIL_IMAP_HOST: z.preprocess(empty, z.string().trim().min(1).max(253).optional()),
  MAIL_IMAP_PORT: z.preprocess(empty, z.coerce.number().int().min(1).max(65_535).optional()),
  MAIL_IMAP_SECURE: z.preprocess(empty, z.enum(["true", "false"]).default("true")),
  MAIL_IMAP_USER: z.preprocess(empty, z.string().trim().min(1).max(320).optional()),
  MAIL_IMAP_PASSWORD: z.preprocess(empty, z.string().min(1).max(1000).optional()),
  MAIL_IMAP_ACCESS_TOKEN: z.preprocess(empty, z.string().min(1).max(8000).optional()),
  MAIL_IMAP_MAILBOX: z.preprocess(empty, z.string().trim().min(1).max(200).default("INBOX")),
  MAIL_IMAP_MAX_PER_SYNC: z.preprocess(empty, z.coerce.number().int().min(1).max(500).default(50)),
});

export interface InboxConfig {
  host: string;
  port: number;
  /** Direct TLS (IMAPS). */
  secure: boolean;
  user: string;
  auth: { kind: "password"; pass: string } | { kind: "oauth2"; accessToken: string };
  mailbox: string;
  /** Messages read per synchronisation (the first one imports only the latest ones). */
  maxPerSync: number;
}

/** A configuration error a person can fix (safe to show; never contains a secret). */
export class InboxConfigError extends Error {}

const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** The mailbox settings, or null when the mailbox is not configured (MAIL_IMAP_HOST / MAIL_IMAP_USER unset). */
export function inboxConfig(
  env: Record<string, string | undefined> = process.env,
): InboxConfig | null {
  const parsed = Env.safeParse(env);
  if (!parsed.success)
    throw new InboxConfigError(
      `Invalid mailbox settings: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const e = parsed.data;
  if (!e.MAIL_IMAP_HOST || !e.MAIL_IMAP_USER) return null;
  const secure = e.MAIL_IMAP_SECURE === "true";
  if (!secure && !LOCAL_HOSTS.has(e.MAIL_IMAP_HOST.toLowerCase()))
    throw new InboxConfigError(
      "MAIL_IMAP_SECURE=false is only allowed for a server on this machine: use TLS (port 993) for a remote mailbox.",
    );
  if (Boolean(e.MAIL_IMAP_PASSWORD) === Boolean(e.MAIL_IMAP_ACCESS_TOKEN))
    throw new InboxConfigError(
      "Set exactly one of MAIL_IMAP_PASSWORD (app password) or MAIL_IMAP_ACCESS_TOKEN (OAuth 2.0).",
    );
  return {
    host: e.MAIL_IMAP_HOST,
    port: e.MAIL_IMAP_PORT ?? (secure ? 993 : 143),
    secure,
    user: e.MAIL_IMAP_USER,
    auth: e.MAIL_IMAP_ACCESS_TOKEN
      ? { kind: "oauth2", accessToken: e.MAIL_IMAP_ACCESS_TOKEN }
      : { kind: "password", pass: e.MAIL_IMAP_PASSWORD ?? "" },
    mailbox: e.MAIL_IMAP_MAILBOX,
    maxPerSync: e.MAIL_IMAP_MAX_PER_SYNC,
  };
}

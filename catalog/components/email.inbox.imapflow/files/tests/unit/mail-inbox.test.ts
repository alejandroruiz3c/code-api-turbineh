import { afterEach, describe, expect, it } from "vitest";
import { startImapMock, type ImapMock } from "../e2e/mocks/imap/server";
import { inboxConfig, InboxConfigError, type InboxConfig } from "@/mail/inbox/config";
import { fetchNewMessages, parseMessage } from "@/mail/inbox/imap";
import { memoryStore, syncInbox } from "@/mail/inbox/sync";

/**
 * Contract tests of the mailbox reader (component email.inbox.imapflow) against a local IMAP server
 * (tests/e2e/mocks/imap/server.ts, RFC 3501 responses): imapflow signs in, opens the mailbox read-only and reads new
 * messages by UID; mailparser parses them. No network: the server listens on 127.0.0.1.
 */
const servers: ImapMock[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const USER = "owner@example.com";
const password = () => `pw ${Math.random().toString(36).slice(2)} "quoted"`;

function email(n: number, extra: { subject?: string; body?: string; attachment?: boolean } = {}) {
  const boundary = `b${n}`;
  const head = [
    `From: "Sender ${n}" <sender${n}@example.org>`,
    `To: ${USER}`,
    `Subject: ${extra.subject ?? `Message ${n}`}`,
    `Date: Mon, 12 Oct 2026 0${n % 10}:15:00 +0200`,
    `Message-ID: <m${n}@example.org>`,
    "MIME-Version: 1.0",
  ];
  if (!extra.attachment)
    return [...head, "Content-Type: text/plain; charset=utf-8", "", extra.body ?? `Body ${n}`].join(
      "\n",
    );
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    extra.body ?? `Body ${n}`,
    `--${boundary}`,
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 synthetic").toString("base64"),
    `--${boundary}--`,
  ].join("\n");
}

async function server(opts: { password?: string; accessToken?: string } = {}) {
  const s = await startImapMock({ user: USER, ...opts });
  servers.push(s);
  return s;
}

const config = (s: ImapMock, auth: InboxConfig["auth"], maxPerSync = 50): InboxConfig => ({
  host: "127.0.0.1",
  port: s.port,
  secure: false,
  user: USER,
  auth,
  mailbox: "INBOX",
  maxPerSync,
});

// Each test opens real IMAP sessions on 127.0.0.1: allow for a slow, shared sandbox.
describe("mailbox reader (component email.inbox.imapflow)", { timeout: 30_000 }, () => {
  it("reads the mailbox read-only: EXAMINE and BODY.PEEK only, nothing is marked as read, moved or deleted", async () => {
    const pass = password();
    const s = await server({ password: pass });
    s.add(email(1));
    s.add(email(2), { flags: ["\\Seen"] });
    const got = await fetchNewMessages(config(s, { kind: "password", pass }), {
      uidValidity: null,
      lastUid: 0,
    });
    expect(got.messages.map((m) => m.uid)).toEqual([1, 2]);
    expect(got.messages.map((m) => m.seen)).toEqual([false, true]);
    expect(s.commands).toContain("EXAMINE INBOX");
    expect(
      s.commands.some((c) => /^(UID )?(SELECT|STORE|EXPUNGE|COPY|MOVE|APPEND)\b/.test(c)),
    ).toBe(false);
    expect(
      s.commands.filter((c) => c.startsWith("UID FETCH")).every((c) => c.includes("BODY.PEEK[]")),
    ).toBe(true);
    expect(s.messages[0]?.flags, "the server still has the message unread").toEqual([]);
  });

  it("synchronises incrementally by UID: a second run reads only the messages that arrived after the first", async () => {
    const pass = password();
    const s = await server({ password: pass });
    s.add(email(1));
    s.add(email(2));
    const store = memoryStore();
    const cfg = config(s, { kind: "password", pass });
    const first = await syncInbox({ store, config: cfg });
    expect(first).toMatchObject({
      configured: true,
      fetched: 2,
      stored: 2,
      reset: true,
      lastUid: 2,
    });
    // Nothing new: "3:*" still returns the highest UID (2) from the server; it is not read again.
    const idle = await syncInbox({ store, config: cfg });
    expect(idle).toMatchObject({ fetched: 0, stored: 0, reset: false, lastUid: 2 });
    s.add(email(3));
    const second = await syncInbox({ store, config: cfg });
    expect(second).toMatchObject({ fetched: 1, stored: 1, reset: false, lastUid: 3 });
    expect([...store.messages.values()].map((m) => m.subject)).toEqual([
      "Message 1",
      "Message 2",
      "Message 3",
    ]);
    expect(s.commands.filter((c) => c.startsWith("UID SEARCH")).at(-1)).toBe("UID SEARCH UID 3:*");
  });

  it("starts again when the server changes UIDVALIDITY, and a first run imports only the latest messages", async () => {
    const pass = password();
    const s = await server({ password: pass });
    for (let i = 1; i <= 5; i++) s.add(email(i));
    const store = memoryStore();
    const cfg = config(s, { kind: "password", pass }, 3);
    const first = await syncInbox({ store, config: cfg });
    expect(first).toMatchObject({ fetched: 3, lastUid: 5, reset: true });
    expect([...store.messages.values()].map((m) => m.uid)).toEqual([3, 4, 5]);
    s.renumber(s.uidValidity + 1);
    const after = await syncInbox({ store, config: cfg });
    expect(after.reset).toBe(true);
    expect(after.fetched).toBe(3);
  });

  it("signs in with an app password or with an OAuth 2.0 access token (XOAUTH2); wrong credentials are refused", async () => {
    const pass = password();
    const token = `ya29.${Math.random().toString(36).slice(2)}`;
    const s = await server({ password: pass, accessToken: token });
    s.add(email(1));
    const since = { uidValidity: null, lastUid: 0 };
    expect(
      (await fetchNewMessages(config(s, { kind: "password", pass }), since)).messages,
    ).toHaveLength(1);
    expect(
      (await fetchNewMessages(config(s, { kind: "oauth2", accessToken: token }), since)).messages,
    ).toHaveLength(1);
    await expect(
      fetchNewMessages(config(s, { kind: "password", pass: "wrong" }), since),
    ).rejects.toThrow();
    await expect(
      fetchNewMessages(config(s, { kind: "oauth2", accessToken: "expired" }), since),
    ).rejects.toThrow();
    expect(s.commands.join(" "), "credentials are never echoed").not.toContain(pass);
  });

  it("parses each message with mailparser: sender, subject, date, text and attachment names (contents are never kept)", async () => {
    const m = await parseMessage(
      7,
      email(7, { subject: "Invoice 2026-114", body: "Total due: 120.50 EUR", attachment: true }),
      { internalDate: "2026-10-12T08:00:00Z", flags: new Set(["\\Seen"]) },
    );
    expect(m).toMatchObject({
      uid: 7,
      messageId: "<m7@example.org>",
      from: { name: "Sender 7", address: "sender7@example.org" },
      to: [USER],
      subject: "Invoice 2026-114",
      text: "Total due: 120.50 EUR",
      seen: true,
    });
    expect(m.date?.toISOString()).toBe("2026-10-12T05:15:00.000Z");
    expect(m.receivedAt.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(m.attachments).toEqual([
      { filename: "invoice.pdf", contentType: "application/pdf", size: expect.any(Number) },
    ]);
    expect(JSON.stringify(m)).not.toContain("JVBERi0");
  });

  it("is configured only by environment variables: TLS is required for a remote server, exactly one credential", () => {
    expect(inboxConfig({})).toBeNull();
    const base = { MAIL_IMAP_HOST: "imap.example.com", MAIL_IMAP_USER: USER };
    expect(inboxConfig({ ...base, MAIL_IMAP_PASSWORD: "app-password" })).toMatchObject({
      port: 993,
      secure: true,
      mailbox: "INBOX",
      auth: { kind: "password" },
    });
    expect(inboxConfig({ ...base, MAIL_IMAP_ACCESS_TOKEN: "token" })?.auth.kind).toBe("oauth2");
    expect(() =>
      inboxConfig({ ...base, MAIL_IMAP_SECURE: "false", MAIL_IMAP_PASSWORD: "x" }),
    ).toThrow(InboxConfigError);
    expect(() => inboxConfig({ ...base })).toThrow(InboxConfigError);
    expect(() =>
      inboxConfig({ ...base, MAIL_IMAP_PASSWORD: "x", MAIL_IMAP_ACCESS_TOKEN: "y" }),
    ).toThrow(InboxConfigError);
    expect(
      inboxConfig({
        ...base,
        MAIL_IMAP_HOST: "127.0.0.1",
        MAIL_IMAP_SECURE: "false",
        MAIL_IMAP_PASSWORD: "x",
      })?.port,
    ).toBe(143);
  });
});

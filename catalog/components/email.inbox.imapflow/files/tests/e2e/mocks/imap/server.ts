import { createServer, type Server, type Socket } from "node:net";

/**
 * Local IMAP4rev1 server for tests (component email.inbox.imapflow): no network, no real mailbox. It implements what
 * an IMAP client needs to read a mailbox the way the documented protocol (RFC 3501) answers it — greeting with
 * capabilities, LOGIN, AUTHENTICATE XOAUTH2 (SASL-IR), NAMESPACE, LIST, SELECT/EXAMINE with UIDVALIDITY/UIDNEXT,
 * UID SEARCH, (UID) FETCH with BODY[] / BODY.PEEK[] and partial ranges, NOOP, CLOSE, LOGOUT — and refuses what a
 * read-only (EXAMINE) session must refuse (STORE, EXPUNGE, COPY, MOVE). Every command is recorded (credentials never),
 * so tests can prove that a client only reads.
 */
export interface MockMessage {
  uid: number;
  raw: string;
  flags: string[];
  internalDate: Date;
}

export interface ImapMockOptions {
  user: string;
  /** App password (LOGIN). */
  password?: string;
  /** OAuth 2.0 access token (AUTHENTICATE XOAUTH2). */
  accessToken?: string;
  mailbox?: string;
  uidValidity?: number;
}

export interface ImapMock {
  port: number;
  /** Commands received, in order: "EXAMINE INBOX", "UID FETCH 3:* (UID BODY.PEEK[])"… (credentials removed). */
  commands: string[];
  messages: MockMessage[];
  uidValidity: number;
  /** Appends a message (RFC 5322 text) and returns its UID. */
  add(raw: string, opts?: { flags?: string[]; internalDate?: Date }): number;
  /** The server renumbers its UIDs (a new UIDVALIDITY): clients must start again. */
  renumber(uidValidity: number): void;
  close(): Promise<void>;
}

const CAPABILITIES = "IMAP4rev1 AUTH=XOAUTH2 SASL-IR NAMESPACE UIDPLUS";
const WRITES = new Set([
  "STORE",
  "EXPUNGE",
  "COPY",
  "MOVE",
  "APPEND",
  "CREATE",
  "DELETE",
  "RENAME",
]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function imapDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Arguments of a command line: atoms, quoted strings, literals (already inlined), parenthesised groups as text. */
function tokens(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i] ?? "";
    if (ch === " ") {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\") i++;
        s += line[i] ?? "";
        i++;
      }
      out.push(s);
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") {
      const close = ch === "(" ? ")" : "]";
      let depth = 0;
      let s = "";
      for (; i < line.length; i++) {
        const c = line[i] ?? "";
        if (c === ch) depth++;
        if (c === close) depth--;
        s += c;
        if (depth === 0) break;
      }
      i++;
      out.push(s);
      continue;
    }
    let s = "";
    while (i < line.length && line[i] !== " ") {
      s += line[i] ?? "";
      i++;
    }
    out.push(s);
  }
  return out;
}

/** "1:3,5,7:*" → the matching numbers among `all` (ascending); "*" is the largest; "n:*" includes the largest. */
export function inSet(set: string, all: number[]): number[] {
  const max = all.length ? Math.max(...all) : 0;
  const val = (s: string) => (s === "*" ? max : Number(s));
  const keep = new Set<number>();
  for (const part of set.split(",")) {
    const [a, b] = part.split(":");
    const lo = val(a ?? "");
    const hi = b === undefined ? lo : val(b);
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    for (const n of all) if (n >= from && n <= to) keep.add(n);
  }
  return [...keep].sort((x, y) => x - y);
}

export function startImapMock(options: ImapMockOptions, port = 0): Promise<ImapMock> {
  const mailbox = options.mailbox ?? "INBOX";
  const sockets = new Set<Socket>();
  const state: ImapMock = {
    port: 0,
    commands: [],
    messages: [],
    uidValidity: options.uidValidity ?? 1_700_000_001,
    add(raw, opts = {}) {
      const uid = (this.messages.at(-1)?.uid ?? 0) + 1;
      this.messages.push({
        uid,
        raw: raw.replace(/\r?\n/g, "\r\n"),
        flags: opts.flags ?? [],
        internalDate: opts.internalDate ?? new Date(),
      });
      return uid;
    },
    renumber(uidValidity) {
      this.uidValidity = uidValidity;
      this.messages = this.messages.map((m, i) => ({ ...m, uid: i + 1 }));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setEncoding("latin1");
    let authed = false;
    let selected: { readOnly: boolean } | null = null;
    let buffer = "";
    let pending: { line: string; need: number } | null = null;
    const send = (s: string) => {
      if (!socket.destroyed) socket.write(s, "latin1");
    };
    send(`* OK [CAPABILITY ${CAPABILITIES}] TurbineH IMAP mock ready\r\n`);

    const handle = (tag: string, line: string, values: string[]) => {
      const [rawCommand = "", ...args] = tokens(line).map((t) => {
        // eslint-disable-next-line no-control-regex -- literal placeholders are NUL-delimited on purpose
        const m = /^\u0000(\d+)\u0000$/.exec(t);
        return m ? (values[Number(m[1])] ?? "") : t;
      });
      let command = rawCommand.toUpperCase();
      let uidMode = false;
      if (command === "UID") {
        uidMode = true;
        command = (args.shift() ?? "").toUpperCase();
      }
      const secretArgs = command === "LOGIN" || command === "AUTHENTICATE";
      state.commands.push(
        `${uidMode ? "UID " : ""}${command}${secretArgs ? "" : args.length ? ` ${args.join(" ")}` : ""}`,
      );
      const ok = (text: string) => send(`${tag} OK ${text}\r\n`);
      const no = (text: string) => send(`${tag} NO ${text}\r\n`);
      switch (command) {
        case "CAPABILITY":
          send(`* CAPABILITY ${CAPABILITIES}\r\n`);
          return ok("CAPABILITY completed");
        case "NOOP":
          return ok("NOOP completed");
        case "LOGOUT":
          send("* BYE TurbineH IMAP mock logging out\r\n");
          ok("LOGOUT completed");
          return socket.end();
        case "LOGIN": {
          const [user, pass] = args;
          if (options.password && user === options.user && pass === options.password) {
            authed = true;
            return ok(`[CAPABILITY ${CAPABILITIES}] Logged in`);
          }
          return no("[AUTHENTICATIONFAILED] Invalid credentials");
        }
        case "AUTHENTICATE": {
          const [mechanism = "", initial = ""] = args;
          const decoded = Buffer.from(initial, "base64").toString("utf8");
          // eslint-disable-next-line no-control-regex -- SASL XOAUTH2 fields are separated by \x01
          const m = /^user=([^\x01]*)\x01auth=Bearer ([^\x01]*)\x01\x01$/.exec(decoded);
          if (
            mechanism.toUpperCase() === "XOAUTH2" &&
            options.accessToken &&
            m?.[1] === options.user &&
            m[2] === options.accessToken
          ) {
            authed = true;
            return ok(`[CAPABILITY ${CAPABILITIES}] Authenticated`);
          }
          return no("[AUTHENTICATIONFAILED] Invalid credentials");
        }
      }
      if (!authed) return send(`${tag} BAD Authenticate first\r\n`);
      switch (command) {
        case "NAMESPACE":
          send('* NAMESPACE (("" "/")) NIL NIL\r\n');
          return ok("NAMESPACE completed");
        case "LIST":
        case "LSUB": {
          const pattern = args[1] ?? "";
          if (pattern === "") send(`* ${command} (\\Noselect) "/" ""\r\n`);
          else if (
            pattern === "*" ||
            pattern === "%" ||
            pattern.toUpperCase() === mailbox.toUpperCase()
          )
            send(`* ${command} (\\HasNoChildren) "/" ${quote(mailbox)}\r\n`);
          return ok(`${command} completed`);
        }
        case "SELECT":
        case "EXAMINE": {
          if ((args[0] ?? "").toUpperCase() !== mailbox.toUpperCase()) {
            selected = null;
            return no("[NONEXISTENT] Unknown mailbox");
          }
          selected = { readOnly: command === "EXAMINE" };
          send("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n");
          send(
            `* OK [PERMANENTFLAGS (${selected.readOnly ? "" : "\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*"})] Flags\r\n`,
          );
          send(`* ${state.messages.length} EXISTS\r\n`);
          send("* 0 RECENT\r\n");
          send(`* OK [UIDVALIDITY ${state.uidValidity}] UIDs valid\r\n`);
          send(`* OK [UIDNEXT ${(state.messages.at(-1)?.uid ?? 0) + 1}] Predicted next UID\r\n`);
          return ok(`[${selected.readOnly ? "READ-ONLY" : "READ-WRITE"}] ${command} completed`);
        }
        case "CLOSE":
        case "UNSELECT":
          selected = null;
          return ok(`${command} completed`);
      }
      if (!selected) return send(`${tag} BAD Select a mailbox first\r\n`);
      if (WRITES.has(command)) {
        if (selected.readOnly) return no("[READ-ONLY] The mailbox is open read-only");
        return no("[CANNOT] Not supported by the mock");
      }
      switch (command) {
        case "SEARCH": {
          const all = state.messages.map((m) => (uidMode ? m.uid : state.messages.indexOf(m) + 1));
          const crit = args.map((a) => a.toUpperCase());
          let found = all;
          const at = crit.indexOf("UID");
          if (at >= 0) {
            const uids = inSet(
              args[at + 1] ?? "",
              state.messages.map((m) => m.uid),
            );
            found = state.messages
              .map((m, i) => ({ m, n: uidMode ? m.uid : i + 1 }))
              .filter(({ m }) => uids.includes(m.uid))
              .map(({ n }) => n);
          } else if (crit[0] && crit[0] !== "ALL" && /^[\d:*,]+$/.test(crit[0])) {
            found = inSet(crit[0], all);
          }
          send(`* SEARCH${found.map((n) => ` ${n}`).join("")}\r\n`);
          return ok(`${uidMode ? "UID " : ""}SEARCH completed`);
        }
        case "FETCH": {
          const [set = "", ...rest] = args;
          const items = rest.join(" ").toUpperCase();
          const numbered = state.messages.map((m, i) => ({ m, seq: i + 1 }));
          const keys = inSet(
            set,
            numbered.map(({ m, seq }) => (uidMode ? m.uid : seq)),
          );
          for (const { m, seq } of numbered.filter(({ m, seq }) =>
            keys.includes(uidMode ? m.uid : seq),
          )) {
            const parts: string[] = [`UID ${m.uid}`];
            const body = /BODY(\.PEEK)?\[\](?:<(\d+)\.(\d+)>)?/.exec(items);
            if (body && !body[1] && !selected.readOnly && !m.flags.includes("\\Seen"))
              m.flags.push("\\Seen");
            if (items.includes("FLAGS")) parts.push(`FLAGS (${m.flags.join(" ")})`);
            if (items.includes("INTERNALDATE"))
              parts.push(`INTERNALDATE "${imapDate(m.internalDate)}"`);
            if (items.includes("RFC822.SIZE")) parts.push(`RFC822.SIZE ${m.raw.length}`);
            if (body) {
              const start = body[2] ? Number(body[2]) : null;
              const chunk = start === null ? m.raw : m.raw.slice(start, start + Number(body[3]));
              parts.push(
                `BODY[]${start === null ? "" : `<${start}>`} {${chunk.length}}\r\n${chunk}`,
              );
            }
            send(`* ${seq} FETCH (${parts.join(" ")})\r\n`);
          }
          return ok(`${uidMode ? "UID " : ""}FETCH completed`);
        }
      }
      return send(`${tag} BAD Unknown command\r\n`);
    };

    // A command may carry literals ({n} then n bytes, RFC 3501 §4.3): each is kept aside and stands in the line as a
    // placeholder token, so passwords with spaces or quotes are read exactly.
    let literals: string[] = [];
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (pending) {
          if (buffer.length < pending.need) return;
          literals.push(buffer.slice(0, pending.need));
          buffer = buffer.slice(pending.need);
          pending.line += `\u0000${literals.length - 1}\u0000`;
          const end = buffer.indexOf("\r\n");
          if (end < 0) return;
          const line = pending.line + buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          pending = null;
          complete(line);
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        complete(line);
      }
    });

    const complete = (line: string) => {
      const literal = /\{(\d+)(\+?)\}$/.exec(line);
      if (literal) {
        pending = { line: line.slice(0, literal.index), need: Number(literal[1]) };
        if (!literal[2]) send("+ Ready for literal data\r\n");
        return;
      }
      const space = line.indexOf(" ");
      const tag = space < 0 ? line : line.slice(0, space);
      const values = literals;
      literals = [];
      if (!tag) return;
      handle(tag, space < 0 ? "" : line.slice(space + 1), values);
    };
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      state.port = typeof addr === "object" && addr ? addr.port : port;
      resolve(state);
    }),
  );
}

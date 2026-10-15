/**
 * Zero-setup local PostgreSQL for migrations, dev and E2E: nothing to install, no Docker, no sudo.
 *
 *   pnpm db:local       serve the persistent local database (.turbineh/local-db) on LOCAL_DATABASE_URL
 *   pnpm db:migrate     migrate DATABASE_URL, or the persistent local database when DATABASE_URL is not set
 *   pnpm dev            same, then `next dev`
 *   pnpm test:e2e       when DATABASE_URL is not set: a fresh database for this run only, migrated first
 *
 * Engines (both pinned dev dependencies, chosen automatically; LOCAL_DB_ENGINE=postgres|pglite forces one):
 *   - postgres: real PostgreSQL 17 binaries (embedded-postgres) — the default on Linux x64/arm64 and macOS;
 *   - pglite: PostgreSQL 17 in WebAssembly with pgvector, served over the wire protocol — used when the schema needs
 *     pgvector, when running as root (PostgreSQL refuses root) or when no binary exists for the platform.
 * A DATABASE_URL in the environment, .env.local or .env always wins, except LOCAL_DATABASE_URL itself (the value in
 * .env.example), which means "the local database".
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { createConnection, createServer } from "node:net";
import { arch, platform, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

export const LOCAL_PORT = 54329;
export const LOCAL_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${LOCAL_PORT}/postgres`;
const DATA_DIR = resolve(".turbineh", "local-db");

type Engine = "postgres" | "pglite";
interface Db {
  url: string;
  stop: () => Promise<void>;
}

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const flags = new Set(dash >= 0 ? argv.slice(0, dash) : argv);
const command = dash >= 0 ? argv.slice(dash + 1) : [];

/** DATABASE_URL from the environment, else from .env.local / .env (the files Next.js reads). */
function configuredUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const m = /^\s*DATABASE_URL\s*=\s*["']?([^"'\n#]*)["']?/m.exec(readFileSync(file, "utf8"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

const listening = (port: number) =>
  new Promise<boolean>((done) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.end();
      done(true);
    });
    s.once("error", () => done(false));
  });

const freePort = () =>
  new Promise<number>((done, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });

/** Whether the app's migrations need pgvector (CREATE EXTENSION vector), which the embedded binaries lack. */
function needsVector(): boolean {
  const files = ["scripts/migrate.ts"];
  if (existsSync("drizzle"))
    files.push(
      ...readdirSync("drizzle")
        .filter((f) => f.endsWith(".sql"))
        .map((f) => join("drizzle", f)),
    );
  return files.some(
    (f) => existsSync(f) && /create\s+extension[^;]*\bvector\b/i.test(readFileSync(f, "utf8")),
  );
}

/** Directory of the embedded PostgreSQL binaries for this platform, or null. */
function postgresNative(): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.resolve("embedded-postgres")));
  } catch {
    return null;
  }
  // The platform package sits next to embedded-postgres (pnpm) or in a parent node_modules (npm, yarn).
  const name = join("@embedded-postgres", `${platform()}-${arch()}`, "native");
  for (; dirname(dir) !== dir; dir = dirname(dir)) {
    for (const candidate of [join(dir, name), join(dir, "node_modules", name)])
      if (existsSync(join(candidate, "bin"))) return candidate;
  }
  return null;
}

function chooseEngine(): { engine: Engine; why: string } {
  const forced = process.env.LOCAL_DB_ENGINE;
  if (forced === "postgres" || forced === "pglite")
    return { engine: forced, why: "LOCAL_DB_ENGINE" };
  if (needsVector()) return { engine: "pglite", why: "the schema needs pgvector" };
  if (userInfo().uid === 0) return { engine: "pglite", why: "PostgreSQL refuses to run as root" };
  if (!postgresNative())
    return { engine: "pglite", why: `no PostgreSQL binary for ${platform()}-${arch()}` };
  return { engine: "postgres", why: "PostgreSQL 17" };
}

/** Restores what the binaries' install script would do (pnpm runs no dependency scripts): exec bits, lib links. */
function prepareNative(native: string) {
  for (const f of readdirSync(join(native, "bin"))) chmodSync(join(native, "bin", f), 0o755);
  const links = join(native, "pg-symlinks.json");
  if (!existsSync(links)) return;
  for (const { source, target } of JSON.parse(readFileSync(links, "utf8")) as {
    source: string;
    target: string;
  }[]) {
    const to = join(native, "..", target);
    if (!existsSync(to)) symlinkSync(join(native, "..", source).split("/").pop() as string, to);
  }
}

async function startPostgres(dir: string, port: number, persistent: boolean): Promise<Db> {
  const native = postgresNative();
  if (native) prepareNative(native);
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const fresh = !existsSync(join(dir, "PG_VERSION"));
  if (fresh) rmSync(dir, { recursive: true, force: true });
  // A previous run that was killed leaves its lock behind; nothing listens on the port (checked by the caller).
  else rmSync(join(dir, "postmaster.pid"), { force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "postgres",
    password: "postgres",
    persistent,
    onLog: () => undefined,
    onError: (e) => {
      if (process.env.LOCAL_DB_DEBUG) console.error(e);
    },
  });
  if (fresh) await pg.initialise();
  await pg.start();
  return { url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, stop: () => pg.stop() };
}

async function startPglite(dir: string | null, port: number): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  if (dir) mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir ?? "memory://", { extensions: { vector } });
  // One session shared by every connection (the server multiplexes; a transaction holds the others until it ends).
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port, maxConnections: 64 });
  await server.start();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

/** Starts the chosen engine: persistent in DATA_DIR on LOCAL_PORT, or fresh (temporary) on a free port. */
async function start(fresh: boolean): Promise<Db & { label: string }> {
  const { engine, why } = chooseEngine();
  const port = fresh ? await freePort() : LOCAL_PORT;
  const dir = fresh ? join(tmpdir(), `turbineh-db-${process.pid}-${port}`) : join(DATA_DIR, engine);
  const db =
    engine === "postgres"
      ? await startPostgres(dir, port, !fresh)
      : await startPglite(fresh ? null : dir, port);
  const label =
    engine === "postgres" ? "PostgreSQL 17" : `PGlite (PostgreSQL 17 in WebAssembly; ${why})`;
  return { ...db, label };
}

/** Runs a command with DATABASE_URL set; resolves with its exit code. */
function run(cmd: string[], url: string): Promise<number> {
  return new Promise((done) => {
    const [bin = "true", ...args] = cmd;
    const child = spawn(bin, args, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
      shell: process.platform === "win32",
    });
    const forward = (sig: NodeJS.Signals) => child.kill(sig);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("close", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      done(code ?? (signal ? 1 : 0));
    });
  });
}

const migrate = (url: string) => run(["tsx", "scripts/migrate.ts"], url);

async function main(): Promise<number> {
  const configured = configuredUrl();
  const local = !configured || configured === LOCAL_DATABASE_URL;

  if (flags.has("--serve")) {
    if (await listening(LOCAL_PORT)) {
      console.log(`local-db: already running — DATABASE_URL=${LOCAL_DATABASE_URL}`);
      return 0;
    }
    const db = await start(false);
    const code = await migrate(db.url);
    if (code !== 0) {
      await db.stop();
      return code;
    }
    console.log(`local-db: ${db.label} in ${DATA_DIR} — DATABASE_URL=${db.url} — Ctrl+C to stop`);
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
    await db.stop();
    return 0;
  }

  if (!local) return run(command, configured);
  if (process.env.NODE_ENV === "production") {
    console.error(
      "local-db: DATABASE_URL is required in production (the local database is for dev and tests).",
    );
    return 1;
  }

  let db: (Db & { label: string }) | null = null;
  let url = LOCAL_DATABASE_URL;
  if (flags.has("--fresh")) {
    db = await start(true);
    url = db.url;
    console.log(`local-db: DATABASE_URL is not set — a fresh ${db.label} for this run at ${url}`);
  } else if (await listening(LOCAL_PORT)) {
    console.log(`local-db: DATABASE_URL is not set — using the running local database at ${url}`);
  } else {
    db = await start(false);
    console.log(
      `local-db: DATABASE_URL is not set — using the local ${db.label} in ${DATA_DIR} at ${url}`,
    );
  }
  try {
    if (flags.has("--migrate")) {
      const code = await migrate(url);
      if (code !== 0) return code;
    }
    return await run(command, url);
  } finally {
    await db?.stop();
  }
}

process.exit(await main());

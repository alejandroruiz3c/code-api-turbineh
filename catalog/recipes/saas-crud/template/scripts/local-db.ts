/**
 * Zero-setup local PostgreSQL: PGlite (PostgreSQL 17 compiled to WebAssembly, pgvector included) served over the
 * PostgreSQL wire protocol, so the app, `pnpm db:migrate` and E2E use the real driver and the real migrations with no
 * PostgreSQL, Docker, root or native binaries installed (Linux x64/arm64, macOS, Windows).
 *
 *   pnpm db:local       serve the persistent local database (.turbineh/local-db) on LOCAL_DATABASE_URL
 *   pnpm db:migrate     migrate DATABASE_URL, or the persistent local database when DATABASE_URL is not set
 *   pnpm dev            same, then `next dev`
 *   pnpm test:e2e       when DATABASE_URL is not set: a fresh in-memory database for this run, migrated first
 *
 * A DATABASE_URL in the environment, .env.local or .env always wins, except LOCAL_DATABASE_URL itself (the value in
 * .env.example), which means "the local database".
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export const LOCAL_PORT = 54329;
export const LOCAL_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${LOCAL_PORT}/postgres`;
const DATA_DIR = join(".turbineh", "local-db");

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
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.end();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/** Starts PGlite (in memory when `dir` is null) and serves it on 127.0.0.1:`port`. */
async function serve(dir: string | null, port: number) {
  if (dir) mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir ?? "memory://", { extensions: { vector } });
  // Several connections (the app's pool, migrations, tests) share one database through the server's multiplexer.
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

/** Runs a command with DATABASE_URL set; resolves with its exit code. */
function run(cmd: string[], url: string): Promise<number> {
  return new Promise((resolve) => {
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
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

const migrate = (url: string) => run(["tsx", "scripts/migrate.ts"], url);

async function main(): Promise<number> {
  const fresh = flags.has("--fresh");
  const configured = configuredUrl();
  const local = !configured || configured === LOCAL_DATABASE_URL;

  if (flags.has("--serve")) {
    if (await listening(LOCAL_PORT)) {
      console.log(`local-db: already running — DATABASE_URL=${LOCAL_DATABASE_URL}`);
      return 0;
    }
    const db = await serve(DATA_DIR, LOCAL_PORT);
    const code = await migrate(db.url);
    if (code !== 0) {
      await db.stop();
      return code;
    }
    console.log(
      `local-db: serving ${DATA_DIR} (PGlite) — DATABASE_URL=${db.url} — Ctrl+C to stop`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await db.stop();
    return 0;
  }

  if (!local) return run(command, configured);

  let db: Awaited<ReturnType<typeof serve>> | null = null;
  let url = LOCAL_DATABASE_URL;
  if (fresh) {
    db = await serve(null, await freePort());
    url = db.url;
    console.log(
      `local-db: DATABASE_URL is not set — using a fresh in-memory PostgreSQL (PGlite) for this run at ${url}`,
    );
  } else if (await listening(LOCAL_PORT)) {
    console.log(`local-db: DATABASE_URL is not set — using the running local database at ${url}`);
  } else {
    db = await serve(DATA_DIR, LOCAL_PORT);
    console.log(
      `local-db: DATABASE_URL is not set — using the local PostgreSQL (PGlite) in ${DATA_DIR} at ${url}`,
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

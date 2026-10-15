type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values must never reach a log line. */
const SECRET_KEY = /(key|token|secret|password|authorization)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON logger with secret redaction. */
export function createLogger(scope: string, minLevel: Level = "info"): Logger {
  const log =
    (level: Level) =>
    (msg: string, fields: Record<string, unknown> = {}) => {
      if (order[level] < order[minLevel]) return;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        msg,
        ...(redact(fields) as object),
      });
      (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
    };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}

import { describe, expect, it } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
describe("pino contract", () => {
  it("writes structured JSON and redacts secrets", () => {
    const lines: string[] = [];
    const log = pino(
      { redact: ["password"] },
      new Writable({
        write(c, _e, cb) {
          lines.push(c.toString());
          cb();
        },
      }),
    );
    log.info({ password: "p", user: "u" }, "login");
    const rec = JSON.parse(lines[0] ?? "{}");
    expect(rec.msg).toBe("login");
    expect(rec.password).toBe("[Redacted]");
  });
});

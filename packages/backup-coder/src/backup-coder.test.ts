import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEnv } from "@turbineh/shared";
import {
  BackupCoder,
  BackupPolicyError,
  GENERATED_BACKUP_HEADER,
  backupCoderFromEnv,
  recordGap,
} from "./index.js";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((incoming, res) => {
    const content = incoming.url?.includes("/bad/")
      ? "```ts\nexport function hashResult(s: string): number {\n  let h = 0;\n  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;\n  return h;\n}\n```"
      : "```ts\nexport const x = 1;\n```";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "fake-open-coder",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`;
});
afterAll(() => server.close());

const req = {
  buildId: "b1",
  trigger: "T1" as const,
  capability: "data.csv-import",
  context: { error: "no approved component" },
  instructions: "Parse a CSV of inventory items",
};

describe("BackupCoder", () => {
  it("marks generated code with the backup header and strips fences", async () => {
    const coder = new BackupCoder(
      { ref: "p:m", baseURL: base, apiKey: "k" },
      { ref: "s:m", baseURL: base, apiKey: "k" },
    );
    const res = await coder.fill(req);
    expect(res.code.startsWith(GENERATED_BACKUP_HEADER)).toBe(true);
    expect(res.code).toContain("export const x = 1;");
    expect(res.code).not.toContain("```");
    expect(res.slot).toBe("primary");
  });

  it("fails over to the secondary when the primary is down", async () => {
    const coder = new BackupCoder(
      { ref: "p:m", baseURL: "http://127.0.0.1:9/v1", apiKey: "k" },
      { ref: "s:m", baseURL: base, apiKey: "k" },
      { timeoutMs: 2000 },
    );
    const res = await coder.fill(req);
    expect(res.slot).toBe("secondary");
    expect(res.failedOver).toBe(true);
    expect(res.primaryError).toBeTruthy();
  });

  it("records every covered gap in the catalog flywheel", async () => {
    const coder = new BackupCoder(
      { ref: "p:m", baseURL: base, apiKey: "k" },
      { ref: "s:m", baseURL: base, apiKey: "k" },
    );
    const dir = mkdtempSync(join(tmpdir(), "gaps-"));
    const file = recordGap(dir, req, await coder.fill(req));
    const rec = JSON.parse(readFileSync(file, "utf8"));
    expect(rec).toMatchObject({ capability: "data.csv-import", trigger: "T1", build_id: "b1" });
  });

  it("refuses output that breaks the policy from both slots (ADR-0055)", async () => {
    const coder = new BackupCoder(
      { ref: "p:m", baseURL: `${base}/bad`, apiKey: "k" },
      { ref: "s:m", baseURL: `${base}/bad`, apiKey: "k" },
    );
    await expect(coder.fill(req)).rejects.toBeInstanceOf(BackupPolicyError);
    // The secondary takes over when only the primary's output is refused.
    const mixed = new BackupCoder(
      { ref: "p:m", baseURL: `${base}/bad`, apiKey: "k" },
      { ref: "s:m", baseURL: base, apiKey: "k" },
    );
    const res = await mixed.fill(req);
    expect(res.slot).toBe("secondary");
    expect(res.primaryError).toMatch(/non-cryptographic-hash/);
  });

  it("refuses to start without both slots configured", () => {
    expect(() => backupCoderFromEnv(readEnv({}))).toThrow(/not configured/);
  });
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROTOCOL_VERSIONS } from "./mcp.js";

/**
 * `turbineh mcp` against the official MCP TypeScript client over real stdio: handshake, tool list and tool calls
 * whose results are identical to the CLI's `--json` output.
 */
const here = dirname(fileURLToPath(import.meta.url));
const tsx = join(here, "..", "..", "..", "node_modules", ".bin", "tsx");
const entry = join(here, "index.ts");

let server: Server;
let env: Record<string, string>;
let cwd: string;
let client: Client;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/v1/capabilities"))
      res.end(
        JSON.stringify({
          results: [
            {
              id: "storefront",
              kind: "use_case",
              name: "Storefront",
              summary: "Shop with Stripe checkout",
              components: 12,
              stacks: ["nextjs"],
              requirements: [],
              example: "e",
              score: 0.9,
            },
          ],
          total: { components: 300 },
        }),
      );
    else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "not_found", message: "no", action: "x" } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  cwd = mkdtempSync(join(tmpdir(), "mcp-"));
  writeFileSync(
    join(cwd, "turbineh.json"),
    JSON.stringify({
      schema: "turbineh.package/v1",
      buildId: "b1234567",
      app: { name: "Shop" },
      status: "verified",
      left: [],
      criteria: [{ text: "Pays", status: "met" }],
      gate: { ok: true, verifiedAt: "2026-10-12", steps: [], findings: [] },
      env: { required: [] },
      rerun: [],
    }),
  );
  env = {
    PATH: process.env.PATH ?? "",
    HOME: cwd,
    TURBINEH_TOKEN: "FRONTIERS_TEST",
    TURBINEH_URL: `http://127.0.0.1:${port}`,
    NO_COLOR: "1",
  };
  client = new Client({ name: "turbineh-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: tsx, args: [entry, "mcp"], cwd, env }));
}, 60_000);

afterAll(async () => {
  await client?.close();
  server?.close();
});

// Asynchronous on purpose: the fake API server runs in this process.
const cli = async (...args: string[]) =>
  JSON.parse(
    (await promisify(execFile)(tsx, [entry, ...args, "--json"], { cwd, env })).stdout,
  ) as unknown;

describe("turbineh mcp", () => {
  it("completes the MCP handshake with the official client", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "turbineh" });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    expect(PROTOCOL_VERSIONS).toContain(LATEST_PROTOCOL_VERSION);
    expect(client.getInstructions()).toMatch(/build/);
  });

  it("lists the agent tools with input schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["apply", "build", "left", "plan", "resume", "search", "status", "verify"].sort(),
    );
    expect(tools.find((t) => t.name === "build")?.inputSchema.properties).toHaveProperty("spec");
  });

  it("returns exactly the CLI --json result (search over the API, left on a delivered package)", async () => {
    const s = await client.callTool({ name: "search", arguments: { query: "online shop" } });
    expect(s.isError).toBe(false);
    expect(s.structuredContent).toEqual(await cli("search", "online", "shop"));
    expect(JSON.parse((s.content as { text: string }[])[0]?.text ?? "")).toEqual(
      s.structuredContent,
    );

    const l = await client.callTool({ name: "left", arguments: {} });
    expect(l.structuredContent).toEqual(await cli("left"));
  }, 60_000);

  it("reports failures as tool errors with the same actionable error", async () => {
    const r = await client.callTool({ name: "status", arguments: { id: "nope" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

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
/** Bodies POSTed to /v1/builds/{id}/notify by the notify tool. */
const notified: { url: string; body: unknown }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && /^\/v1\/builds\/[^/]+\/notify$/.test(req.url ?? "")) {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString()));
      req.on("end", () => {
        notified.push({ url: req.url ?? "", body: JSON.parse(data) as unknown });
        res.end(JSON.stringify({ demand: true, email_on_file: true, confirmation: "scheduled" }));
      });
      return;
    }
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
      [
        "ai_token",
        "apply",
        "build",
        "left",
        "notify",
        "plan",
        "resume",
        "search",
        "status",
        "verify",
      ].sort(),
    );
    expect(tools.find((t) => t.name === "build")?.inputSchema.properties).toHaveProperty("spec");
    expect(tools.find((t) => t.name === "verify")?.inputSchema.properties).toHaveProperty("full");
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

  it("notify (ADR-0074): posts the user's email for a refused flow; build and plan take notifyEmail", async () => {
    const id = "00000000-0000-4000-8000-000000000009";
    const r = await client.callTool({
      name: "notify",
      arguments: { id, email: "Person@Example.com" },
    });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toMatchObject({ ok: true, command: "notify", data: { id } });
    expect(notified.at(-1)).toEqual({
      url: `/v1/builds/${id}/notify`,
      body: { email: "Person@Example.com" },
    });
    const bad = await client.callTool({ name: "notify", arguments: { id, email: "not-an-email" } });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ ok: false, error: { code: "usage" } });
    const { tools } = await client.listTools();
    for (const t of ["build", "plan"])
      expect(tools.find((x) => x.name === t)?.inputSchema.properties).toHaveProperty("notifyEmail");
  });

  it("reports failures as tool errors with the same actionable error", async () => {
    const r = await client.callTool({ name: "status", arguments: { id: "nope" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("mcpAction (audit I-17)", () => {
  it("points tool errors at tools, not CLI commands", async () => {
    const { mcpAction } = await import("./mcp.js");
    expect(mcpAction('Run `turbineh build "x"` or `turbineh login`.')).toBe(
      "Run the `build` tool or `turbineh login`.",
    );
  });
});

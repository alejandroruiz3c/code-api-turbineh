import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
describe("@modelcontextprotocol/sdk contract", () => {
  it("exposes an app tool to an agent through MCP (no model involved)", async () => {
    const server = new McpServer({ name: "app-tools", version: "1.0.0" });
    server.registerTool(
      "order_status",
      {
        description: "Status of an order by id",
        inputSchema: { orderId: z.string().regex(/^o-[0-9]+$/) },
      },
      async ({ orderId }) => ({ content: [{ type: "text", text: `${orderId}: shipped` }] }),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["order_status"]);
    const res = await client.callTool({ name: "order_status", arguments: { orderId: "o-42" } });
    expect(res.content).toEqual([{ type: "text", text: "o-42: shipped" }]);
    const bad = await client.callTool({ name: "order_status", arguments: { orderId: "../etc" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});

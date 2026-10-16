// Server code in the app (e.g. src/app/api/support/route.ts): an agent turn with one tool that runs in the app.
import { z } from "zod";
import { defineTool, runAgent, type AgentState } from "@/lib/ai/agent";

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Status of an order by its number",
  parameters: z.object({ order: z.string().regex(/^A-\d+$/) }),
  execute: async ({ order }) => ({ order, status: "shipped" }),
});

export async function supportTurn(
  caller: { organizationId: string; userId: string },
  input: string,
  state: AgentState | null,
) {
  const r = await runAgent({
    ...caller,
    purpose: "support",
    instructions: "You help customers with their orders.",
    input,
    tools: [lookupOrder],
    state,
  });
  // r.reply → show it; r.state → store it for the next turn; r.pending → show Confirm / Cancel.
  return { reply: r.reply, state: r.state, pending: r.pending };
}

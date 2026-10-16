import { gatewayDeps } from "@/server/ai-gateway-deps";
import { handleUsage } from "@/server/ai-orchestration";

export const dynamic = "force-dynamic";

/**
 * GET /v1/ai/v1/usage — the token's account usage report (ADR-0060): requests, tokens, cost as charged, p50/p95
 * latency, the same tokens at a frontier model's list price and the savings, plus the trial balance.
 */
export function GET(req: Request): Promise<Response> {
  return handleUsage(req, gatewayDeps());
}

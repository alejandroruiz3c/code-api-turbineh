import { admitAiRequest, recordAiUsage, reserveAiHedge, verifyAiAppToken } from "@turbineh/db";
import { type GatewayDeps, gatewayConfig } from "./ai-gateway";
import { db } from "./db";

/** Production wiring of the AI gateway (database + real fetch). */
export const gatewayDeps = (): GatewayDeps => {
  const config = gatewayConfig();
  return {
    verifyToken: (token) => verifyAiAppToken(db, token),
    admit: (app) => admitAiRequest(db, app),
    record: (u) => recordAiUsage(db, u),
    reserveHedge: (app, model) =>
      reserveAiHedge(db, {
        appId: app.id,
        model,
        ratio: config.AI_GATEWAY_HEDGE_BUDGET_RATIO,
        minPerDay: config.AI_GATEWAY_HEDGE_BUDGET_MIN,
      }),
    fetch,
    config,
  };
};

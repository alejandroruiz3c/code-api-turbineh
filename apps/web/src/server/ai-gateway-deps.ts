import {
  addAiOwnerSpend,
  admitAiRequest,
  aiOwnerSpend,
  aiUsageTotals,
  recordAiRequest,
  recordAiUsage,
  reserveAiHedge,
  verifyAiAppToken,
} from "@turbineh/db";
import { type GatewayDeps, gatewayConfig } from "./ai-gateway";
import { db } from "./db";

/** Gateway configuration from the environment; internal owners (benchmark and smoke keys) have no trial cap. */
export const gatewayEnvConfig = () =>
  gatewayConfig({
    ...process.env,
    AI_TRIAL_EXEMPT_OWNERS: [process.env.AI_TRIAL_EXEMPT_OWNERS, process.env.OPS_OWNER_IDS]
      .filter(Boolean)
      .join(","),
  });

/** Production wiring of the AI gateway (database + real fetch). */
export const gatewayDeps = (): GatewayDeps => {
  const config = gatewayEnvConfig();
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
    trialSpent: (ownerId) => aiOwnerSpend(db, ownerId),
    addSpend: async (ownerId, usd) => {
      await addAiOwnerSpend(db, ownerId, usd);
    },
    recordRequest: (m) => recordAiRequest(db, m),
    usageTotals: (ownerId) => aiUsageTotals(db, ownerId),
    fetch,
    config,
  };
};

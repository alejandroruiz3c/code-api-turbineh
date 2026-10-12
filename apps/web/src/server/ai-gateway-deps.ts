import { admitAiRequest, recordAiUsage, verifyAiAppToken } from "@turbineh/db";
import { type GatewayDeps, gatewayConfig } from "./ai-gateway";
import { db } from "./db";

/** Production wiring of the AI gateway (database + real fetch). */
export const gatewayDeps = (): GatewayDeps => ({
  verifyToken: (token) => verifyAiAppToken(db, token),
  admit: (app) => admitAiRequest(db, app),
  record: (u) => recordAiUsage(db, u),
  fetch,
  config: gatewayConfig(),
});

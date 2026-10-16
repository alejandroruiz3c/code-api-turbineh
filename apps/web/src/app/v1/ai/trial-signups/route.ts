import {
  aiOwnerSpend,
  provisionOrchestrationTrial,
  recentTrialSignups,
  trialOwnerId,
} from "@turbineh/db";
import { appTokenDefaults } from "@/server/ai-gateway";
import { gatewayEnvConfig } from "@/server/ai-gateway-deps";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { handleTrialSignup, signupIpHash } from "@/server/orchestration-trial";

export const dynamic = "force-dynamic";

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : d;
};

/**
 * POST /v1/ai/trial-signups — provisions an Intelligence Orchestration trial (ADR-0059). Server-to-server only:
 * `Authorization: Bearer <ORCHESTRATION_SIGNUP_SECRET>` (404 when the secret is not configured).
 */
export function POST(req: Request): Promise<Response> {
  const secret = process.env.ORCHESTRATION_SIGNUP_SECRET;
  return handleTrialSignup(req, {
    secret,
    get baseUrl() {
      return env.BETTER_AUTH_URL;
    },
    trialUsd: gatewayEnvConfig().AI_TRIAL_CAP_USD,
    limits: {
      perEmail: int(process.env.ORCHESTRATION_SIGNUPS_PER_EMAIL, 3),
      perIp: int(process.env.ORCHESTRATION_SIGNUPS_PER_IP, 10),
      total: int(process.env.ORCHESTRATION_SIGNUPS_PER_DAY, 200),
    },
    ipHash: (ip) => signupIpHash(env.BETTER_AUTH_SECRET)(ip),
    ownerIdOf: trialOwnerId,
    recent: (input) => recentTrialSignups(db, input),
    provision: (input) => provisionOrchestrationTrial(db, input),
    spent: (ownerId) => aiOwnerSpend(db, ownerId),
    tokenDefaults: appTokenDefaults(),
  });
}

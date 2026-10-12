import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { aiAudit, aiUsage } from "@/db/schema";
import { rateLimit } from "@/security/rate-limit";
import { AiSafetyError } from "./guard";

export * from "./guard";

/**
 * AI Safety Pack · limits and audit (component security.ai-safety.turbineh, ADR-0028): per-user rate limit,
 * daily token budgets per user and per workspace, and an audit record of every AI call (never its content).
 */
const empty = (v: unknown) => (v === "" ? undefined : v);
const Env = z.object({
  AI_REQUESTS_PER_MINUTE_PER_USER: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(600).default(20),
  ),
  AI_DAILY_TOKENS_PER_USER: z.preprocess(empty, z.coerce.number().int().min(1000).default(200_000)),
  AI_DAILY_TOKENS_PER_WORKSPACE: z.preprocess(
    empty,
    z.coerce.number().int().min(1000).default(2_000_000),
  ),
});
let cached: z.infer<typeof Env> | undefined;
const limitsConfig = () => (cached ??= Env.parse(process.env));

export interface AiCaller {
  organizationId: string;
  userId: string;
}

const startOfDayUtc = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

async function tokensToday(where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)`,
    })
    .from(aiUsage)
    .where(where);
  return Number(row?.total ?? 0);
}

/** Refuses the call before any model runs when the user or the workspace is over its limits. */
export async function checkLimits(caller: AiCaller): Promise<void> {
  const cfg = limitsConfig();
  if (!rateLimit(`ai:${caller.userId}`, cfg.AI_REQUESTS_PER_MINUTE_PER_USER)) {
    throw new AiSafetyError("Too many AI requests. Please wait a minute.");
  }
  const since = startOfDayUtc();
  const [user, workspace] = await Promise.all([
    tokensToday(
      and(
        eq(aiUsage.organizationId, caller.organizationId),
        eq(aiUsage.userId, caller.userId),
        gte(aiUsage.createdAt, since),
      ),
    ),
    tokensToday(
      and(eq(aiUsage.organizationId, caller.organizationId), gte(aiUsage.createdAt, since)),
    ),
  ]);
  if (workspace >= cfg.AI_DAILY_TOKENS_PER_WORKSPACE) {
    throw new AiSafetyError("Today's AI allowance for this workspace is used up.");
  }
  if (user >= cfg.AI_DAILY_TOKENS_PER_USER) {
    throw new AiSafetyError("You have used your AI allowance for today.");
  }
}

export interface AuditEntry extends AiCaller {
  purpose: string;
  route: string | null;
  decision: Record<string, unknown> | null;
  input: string;
  flags: string[];
  status: "ok" | "blocked" | "error";
}

/** One audit row per AI call: who, what for, which route, flags and outcome. Content is stored only as a hash. */
export async function audit(entry: AuditEntry): Promise<void> {
  await db.insert(aiAudit).values({
    organizationId: entry.organizationId,
    userId: entry.userId,
    purpose: entry.purpose.slice(0, 64),
    route: entry.route,
    decision: entry.decision,
    inputChars: entry.input.length,
    inputHash: createHash("sha256").update(entry.input).digest("hex"),
    flags: entry.flags.join(",").slice(0, 200),
    status: entry.status,
  });
}

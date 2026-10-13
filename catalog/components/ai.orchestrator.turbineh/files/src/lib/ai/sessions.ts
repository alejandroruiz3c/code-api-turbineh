import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentSessions } from "@/db/schema";
import type { AgentState } from "./agent";

/**
 * Server-side conversation state for runAgent (component ai.orchestrator.turbineh, ADR-0033). The browser keeps only
 * the session id (random UUID); a missing, expired or foreign id starts a new conversation.
 */
export const SESSION_TTL_MS = 24 * 3_600_000;

const empty = (): AgentState => ({ messages: [], pending: null });

export async function loadAgentSession(
  id: string | null | undefined,
  purpose: string,
  now = new Date(),
): Promise<{ id: string | null; state: AgentState; turns: number }> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { id: null, state: empty(), turns: 0 };
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.id, parsed.data),
        eq(agentSessions.purpose, purpose),
        gte(agentSessions.updatedAt, new Date(now.getTime() - SESSION_TTL_MS)),
      ),
    );
  if (!row) return { id: null, state: empty(), turns: 0 };
  return { id: row.id, state: row.state as AgentState, turns: row.turns };
}

/** Saves the state under `id` (a new random id from newSessionId() for a new conversation). */
export async function saveAgentSession(
  id: string,
  purpose: string,
  state: AgentState,
): Promise<string> {
  await db
    .insert(agentSessions)
    .values({ id, purpose, state, turns: 1 })
    .onConflictDoUpdate({
      target: agentSessions.id,
      set: { state, updatedAt: new Date(), turns: sql`${agentSessions.turns} + 1` },
      setWhere: eq(agentSessions.purpose, purpose),
    });
  return id;
}

export const newSessionId = (): string => randomUUID();

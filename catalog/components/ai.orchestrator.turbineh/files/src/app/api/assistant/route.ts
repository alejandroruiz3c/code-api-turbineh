import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import {
  clientIp,
  PUBLIC_PURPOSE,
  publicAssistant,
  publicAssistantConfig,
} from "@/lib/ai/assistant";
import { AiTrialLimitError } from "@/lib/ai/models";
import { loadAgentSession, newSessionId, saveAgentSession } from "@/lib/ai/sessions";
import { toUserMessage, UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";

/**
 * Public assistant endpoint (component ai.orchestrator.turbineh, ADR-0033): no sign-in; every turn goes through
 * runAgent (AI Safety Pack, tools, confirmation of irreversible actions, usage and audit). The conversation state is
 * kept on the server; the browser only holds the session id.
 */
export const dynamic = "force-dynamic";

const Body = z
  .object({
    sessionId: z.uuid().nullable().optional(),
    message: z.string(),
    confirm: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const assistant = publicAssistant();
  if (!assistant.enabled) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const cfg = publicAssistantConfig();
  if (Number(req.headers.get("content-length") ?? 0) > 16_000)
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  if (
    !(await rateLimit(`assistant:ip:${clientIp(req.headers)}`, cfg.AI_PUBLIC_REQUESTS_PER_MINUTE))
  )
    return NextResponse.json(
      { error: "Too many messages. Please wait a minute." },
      { status: 429 },
    );
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const message = body.data.message.trim();
  if (message.length === 0)
    return NextResponse.json({ error: "Please write something first." }, { status: 400 });
  if (message.length > cfg.AI_PUBLIC_MAX_INPUT_CHARS)
    return NextResponse.json(
      { error: `Message too long (max ${cfg.AI_PUBLIC_MAX_INPUT_CHARS} characters).` },
      { status: 400 },
    );

  const session = await loadAgentSession(body.data.sessionId, PUBLIC_PURPOSE);
  if (session.turns >= cfg.AI_PUBLIC_TURNS_PER_CONVERSATION)
    return NextResponse.json(
      { error: "This conversation reached its limit. Please start a new one." },
      { status: 429 },
    );
  const sessionId = session.id ?? newSessionId();
  try {
    const result = await runAgent({
      organizationId: "public",
      // Per-conversation allowance; per-IP limits above; the "public" workspace allowance caps the total.
      userId: `visitor:${sessionId}`,
      purpose: PUBLIC_PURPOSE,
      instructions: assistant.instructions,
      tools: assistant.tools,
      input: message,
      state: session.state,
      confirm: body.data.confirm,
    });
    await saveAgentSession(sessionId, PUBLIC_PURPOSE, result.state);
    return NextResponse.json({
      sessionId,
      reply: result.reply,
      status: result.status,
      pending: result.pending ? { summary: result.pending.summary } : null,
    });
  } catch (err) {
    // The app's AI trial is used up: say so, with who to contact (not a generic failure).
    if (err instanceof AiTrialLimitError)
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    const status = err instanceof UserFacingError ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}

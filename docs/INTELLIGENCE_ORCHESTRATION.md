# Intelligence Orchestration · connect by API or MCP

TurbineH Intelligence Orchestration answers a task with the best route for each request: you send the task, TurbineH
plans it, picks the model and steps, and returns the answer. Connect it over HTTP (OpenAI-compatible) or as a remote
MCP server from any coding agent. Decision record: ADR-0059.

- **API base:** `https://software.turbineh.com/v1/ai/v1`
- **MCP server:** `https://software.turbineh.com/v1/ai/mcp` (Streamable HTTP)
- **Auth:** `Authorization: Bearer tbh_ai_…` (your token; shown once — keep it in an environment variable)
- **Trial:** $2 of usage per account. Every response carries `X-TurbineH-Trial-Remaining-USD`. At the limit every call
  answers **402** `application/problem+json` with `code: "trial_limit_reached"`: _"You've reached the trial limit of
  the TurbineH orchestration ($2). Contact alex.ruiz@turbineh.com to continue."_

The examples use `TURBINEH_AI_TOKEN`:

```bash
export TURBINEH_AI_TOKEN="tbh_ai_…"
```

## HTTP API

### Chat (OpenAI-compatible, orchestrated routing)

```bash
curl https://software.turbineh.com/v1/ai/v1/chat/completions \
  -H "Authorization: Bearer $TURBINEH_AI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "turbineh-orchestration",
    "messages": [
      {"role": "system", "content": "You are a concise support assistant."},
      {"role": "user", "content": "How do I reset my password?"}
    ]
  }'
```

Answer: an OpenAI `chat.completion` (`choices[0].message.content`, `usage`), with `model: "turbineh-orchestration"`.
`"auto"` or no `model` is the same. Not supported on this model: `stream: true` and `tools` (use `/agent`). Any
OpenAI SDK works with `baseURL = https://software.turbineh.com/v1/ai/v1`, `apiKey = $TURBINEH_AI_TOKEN` and
`model = "turbineh-orchestration"`.

### Orchestrate (task + input, optional JSON Schema)

```bash
curl https://software.turbineh.com/v1/ai/v1/orchestrate \
  -H "Authorization: Bearer $TURBINEH_AI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Classify the sentiment of the review",
    "input": "The delivery was late but the product is great.",
    "schema": {
      "type": "object",
      "properties": {"sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]}},
      "required": ["sentiment"]
    }
  }'
```

Body: `task` (≤ 4000 chars), `input` (≤ 200000), optional `instructions` (≤ 8000), `schema` (JSON Schema; the answer
is JSON text that matches it), `context` (`[{ title, text }]`, ≤ 20 documents), `history`
(`[{ role: "user" | "assistant", content }]`, ≤ 20), `timeoutMs` (1000–290000, default 60000). Answer:
`{ text, route, tool, flags, usage: { calls, inputTokens, outputTokens }, decision, … }`.

### Agent step (your tools, run by you)

`POST /v1/ai/v1/agent` runs one step of an agent turn: send `phase` (`start` | `continue` | `confirmed`),
`instructions`, `tools` (`[{ name, description, parameters (JSON Schema), irreversible }]`), `messages`
(OpenAI-style, including `tool` results) and `now` (ISO 8601). The answer is a `reply` or `toolCalls` for you to run;
post their results with `phase: "continue"`. This is the protocol of TurbineH's AI component (`runAgent`).

### Embeddings

```bash
curl https://software.turbineh.com/v1/ai/v1/embeddings \
  -H "Authorization: Bearer $TURBINEH_AI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-embedding-8b", "input": ["first text", "second text"]}'
```

### Errors

RFC 9457 problem details: 400 invalid request, 401 invalid or missing token, 402 `trial_limit_reached`, 413 too
large, 422 `unsafe_request`, 429 rate limit or daily quota, 502/503/504 provider unavailable.

## MCP

Tools: `orchestrate` (`task`, `input`, optional `schema`, `instructions`), `chat` (`messages`) and `trial_status`
(spent, cap, remaining). At the trial limit a tool returns an error result with the message above.

### Claude Code

```bash
claude mcp add --transport http turbineh-orchestration https://software.turbineh.com/v1/ai/mcp \
  --header "Authorization: Bearer $TURBINEH_AI_TOKEN"
```

Add `--scope user` to use it in every project. Check with `claude mcp list` (`✔ Connected`).

### Codex

`~/.codex/config.toml` (the token is read from the environment variable):

```toml
[mcp_servers.turbineh-orchestration]
url = "https://software.turbineh.com/v1/ai/mcp"
bearer_token_env_var = "TURBINEH_AI_TOKEN"
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "turbineh-orchestration": {
      "url": "https://software.turbineh.com/v1/ai/mcp",
      "headers": { "Authorization": "Bearer ${env:TURBINEH_AI_TOKEN}" }
    }
  }
}
```

### Any other MCP client

```json
{
  "mcpServers": {
    "turbineh-orchestration": {
      "url": "https://software.turbineh.com/v1/ai/mcp",
      "headers": { "Authorization": "Bearer tbh_ai_…" }
    }
  }
}
```

## Getting a trial token (operators)

The landing page's server provisions trials with `POST /v1/ai/trial-signups` (server-to-server, ADR-0059):

```bash
curl https://software.turbineh.com/v1/ai/trial-signups \
  -H "Authorization: Bearer $ORCHESTRATION_SIGNUP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email": "ada@example.com", "name": "Ada", "company": "Analytical", "useCase": "Support routing", "clientIp": "203.0.113.7"}'
```

`201 { token, prefix, apiBase, mcpUrl, trialUsd, remainingUsd, existing, contact }`. Trial accounts:
`pnpm --filter @turbineh/db trials` or `GET /v1/ops/trials` (staff only).

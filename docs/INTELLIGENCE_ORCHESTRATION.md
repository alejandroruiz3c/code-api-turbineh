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
`"auto"` or no `model` is the same. `response_format: {"type": "json_object"}` returns the JSON object only (validated).
The answer is never empty: when a model returns no text, TurbineH retries it, and if no model answers you get a 502
`no_answer` you can retry. Not supported on this model: `stream: true` and `tools` (use `/agent`). Any OpenAI SDK works
with `baseURL = https://software.turbineh.com/v1/ai/v1`, `apiKey = $TURBINEH_AI_TOKEN` and
`model = "turbineh-orchestration"`. Extra field (ignored by SDKs): `turbineh` = `{ route, calls, flags, metrics }`
(see [Measure it](#measure-it)).

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
`{ text, route, tool, flags, usage: { calls, inputTokens, outputTokens }, decision, turbineh: { metrics } }`.

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

## Measure it

Every answer tells you what that call cost and how long it took, next to what the same tokens would cost on a
frontier model at its list price. Nothing to configure.

**Per call** — in `turbineh.metrics` (chat completions, `/orchestrate`, `/agent`) or `structuredContent.metrics` (MCP
`orchestrate` and `chat`):

| Field                         | Meaning                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `latency_ms`                  | Time TurbineH took to answer this request, ms                                            |
| `model_calls`                 | Model and decision calls made for it                                                     |
| `input_tokens`                | Input tokens of those calls                                                              |
| `output_tokens`               | Output tokens of those calls                                                             |
| `cost_usd`                    | What it cost, USD, exactly as charged to your trial balance                              |
| `frontier_reference_cost_usd` | The same tokens at a frontier model's list price (USD 4 / 20 per million input / output) |
| `frontier_reference`          | `"frontier model reference (list price)"`                                                |
| `savings_usd`, `savings_pct`  | `frontier_reference_cost_usd − cost_usd`, and that as a % of the reference               |

Headers on the same answers: `X-TurbineH-Latency-Ms`, `X-TurbineH-Cost-USD`, `X-TurbineH-Frontier-Reference-Cost-USD`,
`X-TurbineH-Savings-Pct` and `X-TurbineH-Trial-Remaining-USD`.

**Cumulative** — for every AI app of your account:

```bash
curl https://software.turbineh.com/v1/ai/v1/usage -H "Authorization: Bearer $TURBINEH_AI_TOKEN"
```

`{ object: "turbineh.usage_report", since, until, requests, failed_requests, model_calls, input_tokens, output_tokens,
latency_ms: { p50, p95 }, cost_usd, frontier_reference_cost_usd, frontier_reference, savings_usd, savings_pct,
by_surface: { chat, chat-direct, orchestrate, agent, mcp:orchestrate, mcp:chat }, trial: { cap_usd, spent_usd,
remaining_usd, reached } }` — free. Over MCP: the `usage_report` tool returns the same.

The frontier reference is an estimate on the same token counts (another model would not use exactly the same number of
tokens); latency percentiles cover successful requests; `trial.spent_usd` also counts calls made before measurements
existed.

### Errors

RFC 9457 problem details: 400 invalid request, 401 invalid or missing token, 402 `trial_limit_reached`, 413 too
large, 422 `unsafe_request`, 429 rate limit or daily quota, 502 `no_answer` (no model returned an answer; retry),
502/503/504 provider unavailable.

## MCP

Tools: `orchestrate` (`task`, `input`, optional `schema`, `instructions`), `chat` (`messages`), `usage_report`
(cumulative cost, latency and savings, see [Measure it](#measure-it)) and `trial_status` (spent, cap, remaining). At the trial limit a tool returns an error result with the message above.

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

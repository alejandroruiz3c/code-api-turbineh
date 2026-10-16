# ADR-0067 · Social networks as first-class components: connections, publishing, metrics

- Status: accepted (number reserved for this change; 0062–0066 belong to parallel work)
- Date: 2026-10-16
- Context: audit v2 (16/10/2026) §5.1 — the catalogue had no third-party integrations beyond Stripe and Resend, where
  B2B demand concentrates; §6 — the request "autonomous social media publisher" was delivered as a CRUD panel: the
  four capabilities that define the product (connect, adapt, publish, measure) were missing; §8 P1 — "Integraciones
  de terceros como componentes de primera clase (empezar por social: LinkedIn, Meta Graph y X)", DoD "componentes con
  contract tests contra mocks y sandbox de cada proveedor". Owner rule (ADR-0052): only what a component proves is
  covered.

## Decision

### 1 · Three native components (ADR-0033/0041 pattern: files/, params schema, guide, acceptance, aliases)

| Component                     | Provides         | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social.connections.turbineh` | `social.oauth`   | OAuth 2.0 per provider as documented: LinkedIn 3-legged code flow (Sign In with LinkedIn + Share on LinkedIn, `w_member_social`), Meta Facebook Login for Business (long-lived user token → Page tokens and the Pages' Instagram professional accounts, `appsecret_proof` on every Graph call), X Authorization Code with PKCE S256 (confidential client, rotating refresh tokens). Single-use state bound to person, workspace and provider (10 min). Tokens sealed with AES-256-GCM under `SOCIAL_TOKEN_KEY` with the row as AAD (workspace, network, account, kind), refreshed 5 min before expiry when the provider allows, revoked at the provider on disconnect (X, Meta; LinkedIn has no revocation API), never selected for screens, exports or logs (ADR-0054 F01). Connecting needs `can(role, "configure")`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `social.publish.turbineh`     | `social.publish` | LinkedIn Posts API (`POST /rest/posts`, `Linkedin-Version: 202609`, Rest.li 2.0, "little" text with escaped reserved characters and hashtag templates; images via `/rest/images?action=initializeUpload` + PUT), Graph v26.0 `/{page-id}/feed` and `/photos`, Instagram `/{ig-user-id}/media` → status `FINISHED` → `/media_publish`, X `POST /2/tweets` and `POST /2/media/upload`. Per-network rules checked in the composer and on the server, nothing cut silently (X weighted 280 per twitter-text v3: URLs 23, emoji and CJK 2; LinkedIn 3,000; Instagram 2,200 + required image, 30 hashtags, 20 mentions). Optional approval (`can(role, "approve")`), schedule typed in the author's IANA zone, unique `(organization_id, idempotency_key)`, runner route `/api/social/publish/run` (CRON_SECRET) that claims each due post with a conditional update and a 3-minute lease, retries 429/5xx/lost requests with exponential backoff + full jitter (p-retry's policy, stored as `next_attempt_at` so serverless runs never sleep) honouring Retry-After / `x-rate-limit-reset`, marks interrupted attempts `unknown` instead of re-sending, an append-only publication log (database trigger), a month calendar. |
| `social.metrics.turbineh`     | `social.metrics` | Per published post on a schedule: LinkedIn `GET /rest/socialMetadata/{urn}` (reactions, comments), Graph post `shares,reactions.summary(total_count),comments.summary(total_count)`, Instagram `like_count,comments_count` + insights `views,shares`, X `public_metrics` (likes, replies, reposts + quotes, impressions). Snapshots; a metric the network does not report stays null, never 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

`publish` requires `connections`, `metrics` requires `publish` (`relations.requires`, pulled in by
`required-components.ts`). Native components ship no npm dependency (the template's lockfile is frozen), so backoff is
implemented in `src/social/retry.ts` with p-retry's policy instead of importing `ops.retry.p-retry`.

### 2 · Proof: contract tests against provider mocks, E2E in the gate

- `tests/e2e/mocks/{LINKEDIN_API_BASE,META_GRAPH_API_BASE,X_API_BASE}.ts` (shipped by connections, used by all three):
  one mock server per provider recorded from its official documentation (2026-10), serving the consent page and the
  API, refusing what the real endpoint refuses (wrong client secret, redirect URI, PKCE verifier, `appsecret_proof`,
  missing `Linkedin-Version`, unknown author URN, un-uploaded media, unknown tokens), recording requests
  (`/__mock/requests`) and injecting failures (`/__mock/fail`). `playwright.config.ts` (base template) points the
  `*_API_BASE` and `*_AUTH_BASE_URL` variables at them and generates throwaway app credentials and `SOCIAL_TOKEN_KEY`.
- Unit contract tests (vitest) start the same mocks in-process: the three OAuth flows, publishing on the four networks
  (exact request bodies and headers), metrics reads.
- E2E: connect each provider through its consent page, tokens encrypted in the database and absent from pages, forged
  state refused, disconnect revokes; approval → scheduled runner → published once with the documented request; 503 →
  retry with backoff → published with every attempt logged; X over 280 refused, a shorter X version passes; Instagram
  without image refused; unique idempotency key and append-only log enforced by PostgreSQL; calendar; metrics stored,
  shown, not refetched while fresh; null for unreported metrics.
- `verify:recipe saas-crud+social.connections.turbineh+social.publish.turbineh+social.metrics.turbineh` (a
  `COMPONENT_COMBINATIONS` entry, so CI's `--all --domains --quick` runs it) and `verify:spec social-publisher` (a
  fidelity fixture: the audit's request without autonomy or AI drafts) run the full sandbox gate.

**Not proven:** the live platforms. No real app credentials were used (none are needed for the mocks, and none may be
committed); LinkedIn and X have no public sandbox, and Meta's test apps need a real Meta app. The DoD's "sandbox of
each provider" part stays open: a live smoke test needs the owner's developer apps and is a follow-up.

### 3 · Selection and scope

- Capabilities `social.oauth`, `social.publish`, `social.metrics` (compiler `CAPABILITIES`, selector labels).
- Fidelity patterns `social.connections`, `social.publish`, `social.metrics` (`detectSocial` in
  `packages/compiler/src/fidelity/patterns.ts`): a sentence that connects, publishes to or measures LinkedIn,
  Facebook, Instagram or X (or "social media") selects them with the networks named (all four when none is) and
  `requireApproval` on unless the request says "without approval". Share buttons, profile links and handles select
  nothing.
- Scope gate (ADR-0052): a platform is covered when an approved component's `does` names it, so LinkedIn, Facebook,
  Instagram, X and "social media" publishing are now covered. Still not covered, by code: autonomous publishing without
  a person ("autonomous", "without human approval"), AI drafts in a use case without AI, and every other network
  (TikTok, YouTube, Pinterest, Threads, Bluesky, Mastodon…). The audit's literal request therefore stays
  `use_case_not_covered` (its headline is autonomous); the same request with approval and without AI drafts is covered.

### 4 · Recipe: not shipped

A `social-publisher` recipe (AI drafts from a brand voice via the orchestrator, content calendar of topics and
frequency, approval, scheduling, publishing, metrics) was not built: AI drafting and the topic/frequency planner are
not proven by any test here, and the recipe may ship only when it passes the full gate with canonical criteria linked
to tests. The components are usable today on any recipe (declared and verified on saas-crud; ai-agents checked too —
see the PR).

## Consequences

- Requests to publish on LinkedIn, Facebook, Instagram or X with a person in the loop get real connections, publishing,
  retries, a log and metrics instead of a CRUD table of "social accounts" with plain-text tokens.
- Each platform's own approvals remain the customer's job and are listed in the components' guides: Meta App Review
  (advanced access to `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`,
  `instagram_manage_insights`, `business_management`) and Business Verification; LinkedIn company pages need the
  Community Management API (`w_organization_social`, not covered) and LinkedIn metrics need restricted read scopes;
  X API access is paid per request.
- API versions are pinned (`LINKEDIN_VERSION=202609`, `META_GRAPH_VERSION=v26.0`); LinkedIn versions live about a
  year, so the pin needs a yearly bump with the mocks updated from the changelog.
- Limits: text and one image by public https URL (no video, carousel, story, thread, poll); X metrics read one post
  per request (billed); interrupted attempts need a person; no live-platform test yet.

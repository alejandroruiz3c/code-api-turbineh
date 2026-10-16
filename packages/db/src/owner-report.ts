import type pg from "pg";

/**
 * Owner usage report across products (ADR-0061): one row per account for each product, a combined per-person view
 * that links the two when they are the same person (same email), totals and this-week-vs-previous-week deltas.
 *
 *  A · YES IF library (web flows, CLI, MCP, API): builds/plans per account, outcomes, checks and requirements,
 *      capabilities and components, time to a verified package, downloads, pull requests, pushes, deploys, uncovered
 *      requests and the AI gateway use of the apps they generated.
 *  B · Intelligence Orchestration (ADR-0059/0060): trial accounts and every account that used the orchestration
 *      gateway: requests, model calls, tokens, latency, cost, frontier-reference cost, savings, trial and surfaces.
 *
 * Deterministic SQL over the platform tables; no model. Staff only: it carries contact data and internal cost.
 */
type Db = Pick<pg.Pool, "query">;

export interface ReportWindow {
  /** Inclusive lower bound, or null for "since the beginning". */
  since: Date | null;
  /** Exclusive upper bound. */
  until: Date;
}

export interface ReportOptions {
  /** Trial cap in USD (`AI_TRIAL_CAP_USD`, default 2; 0 = no cap). */
  trialCapUsd?: number;
  /** Owners without a trial cap (`AI_TRIAL_EXEMPT_OWNERS` + `OPS_OWNER_IDS`). */
  exemptOwners?: readonly string[];
}

export interface Identity {
  email: string | null;
  name: string | null;
  githubLogin: string | null;
  /** Where the email came from: trial | account | priority_list | demand | build_contact. */
  emailSource: string | null;
}

export interface SurfaceSplit {
  requests: number;
  costUsd: number;
}

export interface OrchestrationRow extends Identity {
  ownerId: string;
  /** trial (signed up on the landing) | app (a generated app's token) | internal (exempt) | other */
  kind: "trial" | "app" | "internal" | "other";
  company: string | null;
  useCase: string | null;
  signupAt: string | null;
  signups: number;
  lastActivityAt: string | null;
  requests: number;
  failedRequests: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  costUsd: number;
  referenceCostUsd: number;
  savingsUsd: number;
  /** Savings over the frontier reference, 0–100, or null without measured cost. */
  savingsPct: number | null;
  trial: {
    /** null when the account has no cap (internal). */
    capUsd: number | null;
    /** All-time spend of the account (every billed call, including before measurements existed). */
    spentUsd: number;
    remainingUsd: number | null;
    reached: boolean;
  };
  bySurface: {
    apiChat: SurfaceSplit;
    orchestrate: SurfaceSplit;
    agent: SurfaceSplit;
    mcp: SurfaceSplit;
  };
}

export interface LibraryRow extends Identity {
  ownerId: string;
  /** user (GitHub sign-in) | workspace (invitation token: web or CLI) | api_key | other */
  accountKind: "user" | "workspace" | "api_key" | "other";
  firstSeenAt: string | null;
  lastActivityAt: string | null;
  /** Flows per channel (web, cli, mcp, api; `unrecorded` before channels were recorded). */
  channels: Record<string, number>;
  flows: number;
  plans: number;
  packagesGenerated: number;
  appBuilds: number;
  improvements: number;
  verified: number;
  deliveredUnverified: number;
  failed: number;
  notCovered: number;
  inProgress: number;
  checksPassed: number;
  checksTotal: number;
  requirementsMet: number;
  requirementsOpen: number;
  capabilities: string[];
  components: string[];
  /** Mean seconds from queueing to a verified result, or null. */
  avgSecondsToVerified: number | null;
  downloads: number;
  pullRequests: number;
  githubPushes: number;
  deploys: number;
  localApplies: number;
  uncoveredRequests: number;
  /** AI apps of the account's generated apps (tokens with a build). */
  aiApps: number;
  aiCalls: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  /** All-time AI spend of the account (USD), shared with its orchestration use. */
  aiSpentUsd: number;
}

export interface PersonRow {
  /** Lowercased email, or the owner id when no email is known. */
  key: string;
  email: string | null;
  name: string | null;
  ownerIds: string[];
  products: ("library" | "orchestration")[];
  lastActivityAt: string | null;
  library:
    | (Pick<
        LibraryRow,
        "flows" | "verified" | "failed" | "notCovered" | "downloads" | "pullRequests" | "deploys"
      > & { channels: string[] })
    | null;
  orchestration:
    | (Pick<
        OrchestrationRow,
        "requests" | "failedRequests" | "costUsd" | "referenceCostUsd" | "savingsUsd"
      > & { trialRemainingUsd: number | null; trialReached: boolean })
    | null;
}

export interface LibrarySummary {
  newAccounts: number;
  activeAccounts: number;
  flows: number;
  verified: number;
  failed: number;
  notCovered: number;
  uncoveredRequests: number;
  downloads: number;
  pullRequests: number;
  deploys: number;
}

export interface OrchestrationSummary {
  newSignups: number;
  signups: number;
  activeAccounts: number;
  requests: number;
  failedRequests: number;
  modelCalls: number;
  costUsd: number;
  referenceCostUsd: number;
  savingsUsd: number;
  savingsPct: number | null;
}

export interface WeekComparison<T> {
  thisWeek: T;
  previousWeek: T;
}

export interface OwnerReport {
  generatedAt: string;
  window: { since: string | null; until: string };
  week: { since: string; until: string; previousSince: string };
  library: {
    rows: LibraryRow[];
    totals: LibrarySummary;
    week: WeekComparison<LibrarySummary>;
  };
  orchestration: {
    rows: OrchestrationRow[];
    totals: OrchestrationSummary;
    week: WeekComparison<OrchestrationSummary>;
  };
  people: PersonRow[];
}

const DAY = 86_400_000;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const round = (v: number, d = 8) => Math.round(v * 10 ** d) / 10 ** d;
const pctOf = (saved: number, reference: number) =>
  reference > 0 ? Math.round((saved / reference) * 1000) / 10 : null;
const latest = (...xs: (string | null)[]) =>
  xs
    .filter((x): x is string => x !== null)
    .sort()
    .at(-1) ?? null;
const windowParams = (w: ReportWindow) => [
  w.since ? w.since.toISOString() : null,
  w.until.toISOString(),
];
const IN_WINDOW = (col: string) =>
  `($1::timestamptz IS NULL OR ${col} >= $1::timestamptz) AND ${col} < $2::timestamptz`;

/** Whether the GitHub sign-in tables (better-auth's `"user"`) exist in this database. */
async function hasAuthUsers(db: Db): Promise<boolean> {
  const r = await db.query<{ t: string | null }>(`SELECT to_regclass('public."user"')::text AS t`);
  return Boolean(r.rows[0]?.t);
}

/** Best known email, name and GitHub login of each owner id (trial profile, sign-in, priority list, demand, builds). */
export async function accountIdentities(
  db: Db,
  ownerIds: readonly string[],
): Promise<Map<string, Identity>> {
  const out = new Map<string, Identity>();
  if (ownerIds.length === 0) return out;
  const users = await hasAuthUsers(db);
  const res = await db.query<{
    owner_id: string;
    trial_email: string | null;
    trial_name: string | null;
    user_email: string | null;
    user_name: string | null;
    github_login: string | null;
    priority_email: string | null;
    demand_email: string | null;
    build_email: string | null;
  }>(
    `SELECT o.owner_id, t.email AS trial_email, t.name AS trial_name,
       ${users ? "u.email" : "NULL::text"} AS user_email, ${users ? "u.name" : "NULL::text"} AS user_name,
       g.login AS github_login, p.email AS priority_email,
       (SELECT d.email FROM use_case_demand d WHERE d.owner_id = o.owner_id AND d.email IS NOT NULL
          ORDER BY d.created_at DESC LIMIT 1) AS demand_email,
       (SELECT b.options->>'contact_email' FROM builds b WHERE b.owner_id = o.owner_id AND b.options ? 'contact_email'
          ORDER BY b.created_at DESC LIMIT 1) AS build_email
     FROM unnest($1::text[]) AS o(owner_id)
     LEFT JOIN orchestration_trials t ON t.owner_id = o.owner_id
     ${users ? `LEFT JOIN "user" u ON 'user:' || u.id = o.owner_id` : ""}
     LEFT JOIN github_connections g ON g.owner_id = o.owner_id
     LEFT JOIN priority_notifications p ON p.owner_id = o.owner_id`,
    [[...new Set(ownerIds)]],
  );
  for (const r of res.rows) {
    const sources: [string | null, string][] = [
      [r.trial_email, "trial"],
      [r.user_email, "account"],
      [r.priority_email, "priority_list"],
      [r.demand_email, "demand"],
      [r.build_email, "build_contact"],
    ];
    const hit = sources.find(([e]) => e && e.trim());
    out.set(r.owner_id, {
      email: hit ? (hit[0] as string).trim().toLowerCase() : null,
      name: r.trial_name ?? r.user_name ?? null,
      githubLogin: r.github_login,
      emailSource: hit ? hit[1] : null,
    });
  }
  return out;
}

const noIdentity: Identity = { email: null, name: null, githubLogin: null, emailSource: null };

// ── B · Intelligence Orchestration ───────────────────────────────────────────────────────────────────────────────

interface OrchRaw {
  owner_id: string;
  company: string | null;
  use_case: string | null;
  signup_at: Date | null;
  signups: number | null;
  last_signup_at: Date | null;
  last_request_at: Date | null;
  requests: string | null;
  failed: string | null;
  model_calls: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cost_usd: string | null;
  reference_cost_usd: string | null;
  p50: number | null;
  p95: number | null;
  chat_n: string | null;
  chat_usd: string | null;
  orchestrate_n: string | null;
  orchestrate_usd: string | null;
  agent_n: string | null;
  agent_usd: string | null;
  mcp_n: string | null;
  mcp_usd: string | null;
  spent_usd: string | null;
  build_apps: string | null;
  is_trial: boolean;
}

const SURFACE = (name: string, cond: string) =>
  `count(*) FILTER (WHERE ${cond}) AS ${name}_n, sum(cost_usd) FILTER (WHERE ${cond}) AS ${name}_usd`;

/** Per-account orchestration rows in the window: trial accounts plus every account with measured gateway requests. */
export async function orchestrationRows(
  db: Db,
  w: ReportWindow,
  opts: ReportOptions = {},
): Promise<OrchestrationRow[]> {
  const res = await db.query<OrchRaw>(
    `WITH m AS (
       SELECT * FROM ai_request_metrics WHERE ${IN_WINDOW("created_at")}
     ), agg AS (
       SELECT owner_id, count(*) AS requests, count(*) FILTER (WHERE NOT ok) AS failed,
         sum(model_calls) AS model_calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
         sum(cost_usd) AS cost_usd, sum(reference_cost_usd) AS reference_cost_usd,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p95,
         ${SURFACE("chat", "surface IN ('chat', 'chat-direct')")},
         ${SURFACE("orchestrate", "surface = 'orchestrate'")},
         ${SURFACE("agent", "surface = 'agent'")},
         ${SURFACE("mcp", "surface LIKE 'mcp:%'")}
       FROM m GROUP BY owner_id
     ), owners AS (
       SELECT owner_id FROM agg
       UNION
       SELECT owner_id FROM orchestration_trials t
       WHERE t.created_at < $2::timestamptz
         AND ($1::timestamptz IS NULL OR t.last_signup_at >= $1::timestamptz)
     )
     SELECT o.owner_id, t.company, t.use_case, t.created_at AS signup_at, t.signups, t.last_signup_at,
       (SELECT max(r.created_at) FROM ai_request_metrics r WHERE r.owner_id = o.owner_id) AS last_request_at,
       a.requests, a.failed, a.model_calls, a.input_tokens, a.output_tokens, a.cost_usd, a.reference_cost_usd,
       a.p50, a.p95, a.chat_n, a.chat_usd, a.orchestrate_n, a.orchestrate_usd, a.agent_n, a.agent_usd,
       a.mcp_n, a.mcp_usd, s.spent_usd,
       (SELECT count(*) FROM ai_apps x WHERE x.owner_id = o.owner_id AND x.build_id IS NOT NULL) AS build_apps,
       (t.owner_id IS NOT NULL) AS is_trial
     FROM owners o
     LEFT JOIN agg a ON a.owner_id = o.owner_id
     LEFT JOIN orchestration_trials t ON t.owner_id = o.owner_id
     LEFT JOIN ai_owner_spend s ON s.owner_id = o.owner_id
     ORDER BY coalesce(a.cost_usd, 0) DESC, coalesce(a.requests, 0) DESC, t.created_at DESC NULLS LAST, o.owner_id`,
    windowParams(w),
  );
  const ids = await accountIdentities(
    db,
    res.rows.map((r) => r.owner_id),
  );
  const cap = opts.trialCapUsd ?? 2;
  const exempt = new Set(
    (opts.exemptOwners ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean),
  );
  return res.rows.map((r) => {
    const cost = n(r.cost_usd);
    const ref = n(r.reference_cost_usd);
    const spent = n(r.spent_usd);
    const internal = exempt.has(r.owner_id.toLowerCase());
    const capUsd = internal || cap <= 0 ? null : cap;
    return {
      ownerId: r.owner_id,
      ...(ids.get(r.owner_id) ?? noIdentity),
      kind: r.is_trial ? "trial" : internal ? "internal" : n(r.build_apps) > 0 ? "app" : "other",
      company: r.company,
      useCase: r.use_case,
      signupAt: iso(r.signup_at),
      signups: n(r.signups),
      lastActivityAt: latest(iso(r.last_request_at), iso(r.last_signup_at)),
      requests: n(r.requests),
      failedRequests: n(r.failed),
      modelCalls: n(r.model_calls),
      inputTokens: n(r.input_tokens),
      outputTokens: n(r.output_tokens),
      latencyP50Ms: r.p50 ?? null,
      latencyP95Ms: r.p95 ?? null,
      costUsd: round(cost),
      referenceCostUsd: round(ref),
      savingsUsd: round(ref - cost),
      savingsPct: pctOf(ref - cost, ref),
      trial: {
        capUsd,
        spentUsd: round(spent),
        remainingUsd: capUsd === null ? null : round(Math.max(0, capUsd - spent)),
        reached: capUsd !== null && spent >= capUsd,
      },
      bySurface: {
        apiChat: { requests: n(r.chat_n), costUsd: round(n(r.chat_usd)) },
        orchestrate: { requests: n(r.orchestrate_n), costUsd: round(n(r.orchestrate_usd)) },
        agent: { requests: n(r.agent_n), costUsd: round(n(r.agent_usd)) },
        mcp: { requests: n(r.mcp_n), costUsd: round(n(r.mcp_usd)) },
      },
    };
  });
}

/** Orchestration KPIs of one window (signups, active accounts, requests, cost, savings). */
export async function orchestrationSummary(db: Db, w: ReportWindow): Promise<OrchestrationSummary> {
  const res = await db.query<{
    new_signups: string;
    signups: string;
    active: string;
    requests: string;
    failed: string;
    model_calls: string | null;
    cost_usd: string | null;
    reference_cost_usd: string | null;
  }>(
    `SELECT
       (SELECT count(*) FROM orchestration_trials WHERE ${IN_WINDOW("created_at")}) AS new_signups,
       (SELECT count(*) FROM orchestration_trial_signups WHERE ${IN_WINDOW("created_at")}) AS signups,
       count(DISTINCT owner_id) AS active, count(*) AS requests, count(*) FILTER (WHERE NOT ok) AS failed,
       sum(model_calls) AS model_calls, sum(cost_usd) AS cost_usd, sum(reference_cost_usd) AS reference_cost_usd
     FROM ai_request_metrics WHERE ${IN_WINDOW("created_at")}`,
    windowParams(w),
  );
  const r = res.rows[0];
  const cost = n(r?.cost_usd);
  const ref = n(r?.reference_cost_usd);
  return {
    newSignups: n(r?.new_signups),
    signups: n(r?.signups),
    activeAccounts: n(r?.active),
    requests: n(r?.requests),
    failedRequests: n(r?.failed),
    modelCalls: n(r?.model_calls),
    costUsd: round(cost),
    referenceCostUsd: round(ref),
    savingsUsd: round(ref - cost),
    savingsPct: pctOf(ref - cost, ref),
  };
}

// ── A · YES IF library ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Per-flow classification shared by the rows and the summaries (mirrors `flowState` in @turbineh/engine, ADR-0037
 * §D1 and ADR-0051, in SQL):
 *  - refused: the scope gate recorded the request as demand (use_case_not_covered);
 *  - verified: a generated package whose own checks all passed (certification-only does not count), or an app build
 *    delivered as `verified`;
 *  - delivered_unverified: a failed gate that still delivered the package;
 *  - failed: any other failure.
 */
const FLOWS = `
  flows AS (
    SELECT b.id, b.owner_id, b.status, b.created_at, b.finished_at, b.metrics, b.options, b.api_key_id,
      b.options->>'mode' AS mode,
      EXISTS (SELECT 1 FROM use_case_demand d WHERE d.build_id = b.id) AS refused,
      CASE WHEN jsonb_typeof(b.metrics->'verify') = 'array' THEN b.metrics->'verify' ELSE '[]'::jsonb END AS verify
    FROM builds b
    WHERE b.owner_id IS NOT NULL AND ${IN_WINDOW("b.created_at")}
  ), classified AS (
    SELECT f.*,
      coalesce(f.status = 'done' AND (
        (f.mode = 'generate'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.verify) c WHERE c->>'name' <> 'certification')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.verify) c WHERE (c->>'ok')::boolean IS NOT TRUE))
        OR (coalesce(f.mode, 'build') IN ('build', 'improve')
          AND coalesce(f.metrics->'delivery'->>'kind', 'verified') = 'verified')), false) AS verified,
      coalesce(f.status = 'failed' AND f.metrics->'delivery'->>'kind' = 'unverified', false) AS delivered_unverified
    FROM flows f
  )`;

interface LibRaw {
  owner_id: string;
  flows: string;
  plans: string;
  generated: string;
  app_builds: string;
  improvements: string;
  verified: string;
  delivered_unverified: string;
  failed: string;
  refused: string;
  in_progress: string;
  checks_passed: string | null;
  checks_total: string | null;
  req_met: string | null;
  req_open: string | null;
  capabilities: string[] | null;
  components: string[] | null;
  avg_s: string | null;
  channels: Record<string, number> | null;
  local_applies: string | null;
  first_seen: Date | null;
  last_build: Date | null;
  downloads: string | null;
  pull_requests: string | null;
  pushes: string | null;
  deploys: string | null;
  demand: string | null;
  last_demand: Date | null;
  last_other: Date | null;
  ai_apps: string | null;
  ai_calls: string | null;
  ai_in: string | null;
  ai_out: string | null;
  ai_spent: string | null;
}

/** Per-account library rows in the window: every account that started a flow or made an uncovered request. */
export async function libraryRows(db: Db, w: ReportWindow): Promise<LibraryRow[]> {
  const res = await db.query<LibRaw>(
    `WITH ${FLOWS},
     per AS (
       SELECT owner_id, count(*) AS flows,
         count(*) FILTER (WHERE mode IN ('plan', 'generate')) AS plans,
         count(*) FILTER (WHERE mode = 'generate') AS generated,
         count(*) FILTER (WHERE mode IS NULL OR mode NOT IN ('plan', 'generate', 'improve')) AS app_builds,
         count(*) FILTER (WHERE mode = 'improve') AS improvements,
         count(*) FILTER (WHERE verified) AS verified,
         count(*) FILTER (WHERE delivered_unverified) AS delivered_unverified,
         count(*) FILTER (WHERE status = 'failed' AND NOT refused AND NOT delivered_unverified) AS failed,
         count(*) FILTER (WHERE refused) AS refused,
         count(*) FILTER (WHERE status NOT IN ('done', 'failed')) AS in_progress,
         sum(coalesce(
           (metrics->'handover'->>'checksPassed')::int,
           (metrics->'delivery'->>'checksPassed')::int,
           (SELECT count(*) FROM jsonb_array_elements(verify) c
              WHERE c->>'name' <> 'certification' AND (c->>'ok')::boolean IS TRUE)::int)) AS checks_passed,
         sum(coalesce(
           nullif((metrics->'handover'->>'checksTotal')::int, 0),
           nullif((metrics->'delivery'->>'checksTotal')::int, 0),
           (SELECT count(*) FROM jsonb_array_elements(verify) c WHERE c->>'name' <> 'certification')::int))
           AS checks_total,
         sum(coalesce((metrics->'acceptance'->>'met')::int, 0)) AS req_met,
         sum(CASE WHEN jsonb_typeof(metrics->'acceptance'->'open') = 'array'
               THEN jsonb_array_length(metrics->'acceptance'->'open') ELSE 0 END) AS req_open,
         array_remove(array_agg(DISTINCT coalesce(metrics->'plan'->'capability'->>'id', metrics->'recipe'->>'built')), NULL)
           AS capabilities,
         avg(extract(epoch FROM finished_at - coalesce(
               (SELECT max(e.at) FROM build_events e WHERE e.build_id = classified.id AND e.type = 'queued'),
               created_at))) FILTER (WHERE verified AND finished_at IS NOT NULL) AS avg_s,
         sum(CASE WHEN jsonb_typeof(metrics->'integrations') = 'array'
               THEN (SELECT count(*) FROM jsonb_array_elements(metrics->'integrations') i
                       WHERE i->>'where' = 'local' AND i->>'state' IN ('integrated', 'integration_verified'))
               ELSE 0 END) AS local_applies
       FROM classified GROUP BY owner_id
     ), comps AS (
       SELECT owner_id, array_agg(DISTINCT c) AS components FROM (
         SELECT owner_id, jsonb_array_elements_text(metrics->'components') AS c FROM classified
           WHERE jsonb_typeof(metrics->'components') = 'array'
         UNION ALL
         SELECT owner_id, x->>'id' FROM classified, jsonb_array_elements(
           CASE WHEN jsonb_typeof(metrics->'plan'->'components') = 'array'
             THEN metrics->'plan'->'components' ELSE '[]'::jsonb END) x
       ) s WHERE c IS NOT NULL GROUP BY owner_id
     ), chan AS (
       SELECT owner_id, jsonb_object_agg(channel, k) AS channels FROM (
         SELECT owner_id,
           coalesce(options->>'channel', CASE WHEN api_key_id IS NOT NULL THEN 'api' ELSE 'unrecorded' END) AS channel,
           count(*) AS k
         FROM classified GROUP BY 1, 2
       ) s GROUP BY owner_id
     ), dem AS (
       SELECT owner_id, count(*) AS demand, max(created_at) AS last_demand FROM use_case_demand
       WHERE owner_id IS NOT NULL AND ${IN_WINDOW("created_at")} GROUP BY owner_id
     ), owners AS (
       SELECT owner_id FROM per UNION SELECT owner_id FROM dem
     )
     SELECT o.owner_id,
       coalesce(per.flows, 0) AS flows, coalesce(per.plans, 0) AS plans, coalesce(per.generated, 0) AS generated,
       coalesce(per.app_builds, 0) AS app_builds, coalesce(per.improvements, 0) AS improvements,
       coalesce(per.verified, 0) AS verified, coalesce(per.delivered_unverified, 0) AS delivered_unverified,
       coalesce(per.failed, 0) AS failed, coalesce(per.refused, 0) AS refused,
       coalesce(per.in_progress, 0) AS in_progress, per.checks_passed, per.checks_total, per.req_met, per.req_open,
       per.capabilities, comps.components, per.avg_s, chan.channels, per.local_applies,
       (SELECT min(b.created_at) FROM builds b WHERE b.owner_id = o.owner_id) AS first_seen,
       (SELECT max(greatest(b.created_at, b.finished_at)) FROM builds b WHERE b.owner_id = o.owner_id) AS last_build,
       (SELECT count(*) FROM flow_downloads x WHERE x.owner_id = o.owner_id AND ${IN_WINDOW("x.created_at")}) AS downloads,
       (SELECT count(*) FROM repo_integrations x WHERE x.owner_id = o.owner_id AND x.pr_url IS NOT NULL
          AND ${IN_WINDOW("x.created_at")}) AS pull_requests,
       (SELECT count(*) FROM deliveries x WHERE x.owner_id = o.owner_id AND x.status = 'done'
          AND ${IN_WINDOW("x.created_at")}) AS pushes,
       (SELECT count(*) FROM deployments x WHERE x.owner_id = o.owner_id AND x.status = 'done'
          AND ${IN_WINDOW("x.created_at")}) AS deploys,
       dem.demand, (SELECT max(d.created_at) FROM use_case_demand d WHERE d.owner_id = o.owner_id) AS last_demand,
       (SELECT max(t) FROM (
          SELECT max(created_at) AS t FROM flow_downloads WHERE owner_id = o.owner_id
          UNION ALL SELECT max(created_at) FROM repo_integrations WHERE owner_id = o.owner_id
          UNION ALL SELECT max(created_at) FROM deliveries WHERE owner_id = o.owner_id
          UNION ALL SELECT max(created_at) FROM deployments WHERE owner_id = o.owner_id) z) AS last_other,
       (SELECT count(*) FROM ai_apps x WHERE x.owner_id = o.owner_id AND x.build_id IS NOT NULL) AS ai_apps,
       u.calls AS ai_calls, u.input_tokens AS ai_in, u.output_tokens AS ai_out, s.spent_usd AS ai_spent
     FROM owners o
     LEFT JOIN per ON per.owner_id = o.owner_id
     LEFT JOIN comps ON comps.owner_id = o.owner_id
     LEFT JOIN chan ON chan.owner_id = o.owner_id
     LEFT JOIN dem ON dem.owner_id = o.owner_id
     LEFT JOIN ai_owner_spend s ON s.owner_id = o.owner_id
     LEFT JOIN LATERAL (
       SELECT sum(g.calls) AS calls, sum(g.input_tokens) AS input_tokens, sum(g.output_tokens) AS output_tokens
       FROM ai_gateway_usage g JOIN ai_apps a ON a.id = g.app_id
       WHERE a.owner_id = o.owner_id AND a.build_id IS NOT NULL
         AND ($1::timestamptz IS NULL OR g.day >= ($1::timestamptz)::date) AND g.day <= ($2::timestamptz)::date
     ) u ON true
     ORDER BY coalesce(per.flows, 0) DESC, coalesce(dem.demand, 0) DESC, o.owner_id`,
    windowParams(w),
  );
  const ids = await accountIdentities(
    db,
    res.rows.map((r) => r.owner_id),
  );
  return res.rows.map((r) => {
    const kind: LibraryRow["accountKind"] = r.owner_id.startsWith("user:")
      ? "user"
      : r.owner_id.startsWith("invite:")
        ? "workspace"
        : r.owner_id.includes(":") && !r.owner_id.startsWith("trial:")
          ? "other"
          : "api_key";
    return {
      ownerId: r.owner_id,
      ...(ids.get(r.owner_id) ?? noIdentity),
      accountKind: kind,
      firstSeenAt: iso(r.first_seen) ?? iso(r.last_demand),
      lastActivityAt: latest(iso(r.last_build), iso(r.last_demand), iso(r.last_other)),
      channels: Object.fromEntries(
        Object.entries(r.channels ?? {})
          .map(([k, v]) => [k, n(v)] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      flows: n(r.flows),
      plans: n(r.plans),
      packagesGenerated: n(r.generated),
      appBuilds: n(r.app_builds),
      improvements: n(r.improvements),
      verified: n(r.verified),
      deliveredUnverified: n(r.delivered_unverified),
      failed: n(r.failed),
      notCovered: n(r.refused),
      inProgress: n(r.in_progress),
      checksPassed: n(r.checks_passed),
      checksTotal: n(r.checks_total),
      requirementsMet: n(r.req_met),
      requirementsOpen: n(r.req_open),
      capabilities: [...(r.capabilities ?? [])].sort(),
      components: [...(r.components ?? [])].sort(),
      avgSecondsToVerified: r.avg_s == null ? null : Math.round(n(r.avg_s)),
      downloads: n(r.downloads),
      pullRequests: n(r.pull_requests),
      githubPushes: n(r.pushes),
      deploys: n(r.deploys),
      localApplies: n(r.local_applies),
      uncoveredRequests: n(r.demand),
      aiApps: n(r.ai_apps),
      aiCalls: n(r.ai_calls),
      aiInputTokens: n(r.ai_in),
      aiOutputTokens: n(r.ai_out),
      aiSpentUsd: round(n(r.ai_spent)),
    };
  });
}

/** Library KPIs of one window. "New accounts": first flow or first uncovered request inside the window. */
export async function librarySummary(db: Db, w: ReportWindow): Promise<LibrarySummary> {
  const res = await db.query<Record<keyof LibrarySummary, string>>(
    `WITH ${FLOWS}
     SELECT
       (SELECT count(*) FROM (
          SELECT owner_id, min(t) AS first FROM (
            SELECT owner_id, created_at AS t FROM builds WHERE owner_id IS NOT NULL
            UNION ALL SELECT owner_id, created_at FROM use_case_demand WHERE owner_id IS NOT NULL) a
          GROUP BY owner_id) f WHERE ${IN_WINDOW("f.first")}) AS "newAccounts",
       (SELECT count(DISTINCT owner_id) FROM (
          SELECT owner_id FROM classified
          UNION ALL SELECT owner_id FROM use_case_demand WHERE owner_id IS NOT NULL AND ${IN_WINDOW("created_at")}) a)
         AS "activeAccounts",
       (SELECT count(*) FROM classified) AS flows,
       (SELECT count(*) FROM classified WHERE verified) AS verified,
       (SELECT count(*) FROM classified WHERE status = 'failed' AND NOT refused AND NOT delivered_unverified) AS failed,
       (SELECT count(*) FROM classified WHERE refused) AS "notCovered",
       (SELECT count(*) FROM use_case_demand WHERE ${IN_WINDOW("created_at")}) AS "uncoveredRequests",
       (SELECT count(*) FROM flow_downloads WHERE ${IN_WINDOW("created_at")}) AS downloads,
       (SELECT count(*) FROM repo_integrations WHERE pr_url IS NOT NULL AND ${IN_WINDOW("created_at")}) AS "pullRequests",
       (SELECT count(*) FROM deployments WHERE status = 'done' AND ${IN_WINDOW("created_at")}) AS deploys`,
    windowParams(w),
  );
  const r = res.rows[0];
  return {
    newAccounts: n(r?.newAccounts),
    activeAccounts: n(r?.activeAccounts),
    flows: n(r?.flows),
    verified: n(r?.verified),
    failed: n(r?.failed),
    notCovered: n(r?.notCovered),
    uncoveredRequests: n(r?.uncoveredRequests),
    downloads: n(r?.downloads),
    pullRequests: n(r?.pullRequests),
    deploys: n(r?.deploys),
  };
}

// ── Combined view ────────────────────────────────────────────────────────────────────────────────────────────────

/** One row per person: accounts with the same email are the same person, across both products. */
export function combinePeople(
  library: LibraryRow[],
  orchestration: OrchestrationRow[],
): PersonRow[] {
  const people = new Map<string, PersonRow>();
  const get = (r: { ownerId: string; email: string | null; name: string | null }) => {
    const key = r.email ?? r.ownerId;
    let p = people.get(key);
    if (!p) {
      p = {
        key,
        email: r.email,
        name: r.name,
        ownerIds: [],
        products: [],
        lastActivityAt: null,
        library: null,
        orchestration: null,
      };
      people.set(key, p);
    }
    p.name ??= r.name;
    if (!p.ownerIds.includes(r.ownerId)) p.ownerIds.push(r.ownerId);
    return p;
  };
  for (const r of library) {
    const p = get(r);
    if (!p.products.includes("library")) p.products.push("library");
    const l = (p.library ??= {
      flows: 0,
      verified: 0,
      failed: 0,
      notCovered: 0,
      downloads: 0,
      pullRequests: 0,
      deploys: 0,
      channels: [],
    });
    l.flows += r.flows;
    l.verified += r.verified;
    l.failed += r.failed;
    l.notCovered += r.notCovered;
    l.downloads += r.downloads;
    l.pullRequests += r.pullRequests;
    l.deploys += r.deploys;
    l.channels = [...new Set([...l.channels, ...Object.keys(r.channels)])].sort();
    p.lastActivityAt = latest(p.lastActivityAt, r.lastActivityAt);
  }
  for (const r of orchestration) {
    const p = get(r);
    if (!p.products.includes("orchestration")) p.products.push("orchestration");
    const o = (p.orchestration ??= {
      requests: 0,
      failedRequests: 0,
      costUsd: 0,
      referenceCostUsd: 0,
      savingsUsd: 0,
      trialRemainingUsd: null,
      trialReached: false,
    });
    o.requests += r.requests;
    o.failedRequests += r.failedRequests;
    o.costUsd = round(o.costUsd + r.costUsd);
    o.referenceCostUsd = round(o.referenceCostUsd + r.referenceCostUsd);
    o.savingsUsd = round(o.savingsUsd + r.savingsUsd);
    if (r.trial.remainingUsd !== null) o.trialRemainingUsd = r.trial.remainingUsd;
    o.trialReached ||= r.trial.reached;
    p.lastActivityAt = latest(p.lastActivityAt, r.lastActivityAt);
  }
  return [...people.values()].sort(
    (a, b) =>
      b.products.length - a.products.length ||
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") ||
      a.key.localeCompare(b.key),
  );
}

// ── The report ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The full report: rows in the window (default: since the beginning, until now), totals of the same window, and the
 * last 7 days against the 7 days before (ending at `until`).
 */
export async function ownerUsageReport(
  db: Db,
  w: Partial<ReportWindow> = {},
  opts: ReportOptions = {},
): Promise<OwnerReport> {
  const until = w.until ?? new Date();
  const window: ReportWindow = { since: w.since ?? null, until };
  const weekSince = new Date(until.getTime() - 7 * DAY);
  const previousSince = new Date(until.getTime() - 14 * DAY);
  const thisWeek: ReportWindow = { since: weekSince, until };
  const previousWeek: ReportWindow = { since: previousSince, until: weekSince };
  const [lib, orch, libTotals, orchTotals, libWeek, libPrev, orchWeek, orchPrev] =
    await Promise.all([
      libraryRows(db, window),
      orchestrationRows(db, window, opts),
      librarySummary(db, window),
      orchestrationSummary(db, window),
      librarySummary(db, thisWeek),
      librarySummary(db, previousWeek),
      orchestrationSummary(db, thisWeek),
      orchestrationSummary(db, previousWeek),
    ]);
  return {
    generatedAt: new Date().toISOString(),
    window: { since: window.since?.toISOString() ?? null, until: until.toISOString() },
    week: {
      since: weekSince.toISOString(),
      until: until.toISOString(),
      previousSince: previousSince.toISOString(),
    },
    library: { rows: lib, totals: libTotals, week: { thisWeek: libWeek, previousWeek: libPrev } },
    orchestration: {
      rows: orch,
      totals: orchTotals,
      week: { thisWeek: orchWeek, previousWeek: orchPrev },
    },
    people: combinePeople(lib, orch),
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ReportView = "people" | "library" | "orchestration";

/** RFC 4180 field; cells starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
export function csvField(v: unknown): string {
  if (v == null) return "";
  let s = Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS: Record<ReportView, [string, (r: never) => unknown][]> = {
  people: [
    ["email", (r: PersonRow) => r.email],
    ["name", (r: PersonRow) => r.name],
    ["accounts", (r: PersonRow) => r.ownerIds],
    ["products", (r: PersonRow) => r.products],
    ["last_activity", (r: PersonRow) => r.lastActivityAt],
    ["library_flows", (r: PersonRow) => r.library?.flows ?? 0],
    ["library_verified", (r: PersonRow) => r.library?.verified ?? 0],
    ["library_failed", (r: PersonRow) => r.library?.failed ?? 0],
    ["library_not_covered", (r: PersonRow) => r.library?.notCovered ?? 0],
    ["library_downloads", (r: PersonRow) => r.library?.downloads ?? 0],
    ["library_pull_requests", (r: PersonRow) => r.library?.pullRequests ?? 0],
    ["library_deploys", (r: PersonRow) => r.library?.deploys ?? 0],
    ["library_channels", (r: PersonRow) => r.library?.channels ?? []],
    ["orchestration_requests", (r: PersonRow) => r.orchestration?.requests ?? 0],
    ["orchestration_failed", (r: PersonRow) => r.orchestration?.failedRequests ?? 0],
    ["orchestration_cost_usd", (r: PersonRow) => r.orchestration?.costUsd ?? 0],
    ["orchestration_reference_cost_usd", (r: PersonRow) => r.orchestration?.referenceCostUsd ?? 0],
    ["orchestration_savings_usd", (r: PersonRow) => r.orchestration?.savingsUsd ?? 0],
    ["trial_remaining_usd", (r: PersonRow) => r.orchestration?.trialRemainingUsd],
    ["trial_reached", (r: PersonRow) => r.orchestration?.trialReached ?? false],
  ] as [string, (r: never) => unknown][],
  library: [
    ["owner_id", (r: LibraryRow) => r.ownerId],
    ["email", (r: LibraryRow) => r.email],
    ["name", (r: LibraryRow) => r.name],
    ["github_login", (r: LibraryRow) => r.githubLogin],
    ["email_source", (r: LibraryRow) => r.emailSource],
    ["account_kind", (r: LibraryRow) => r.accountKind],
    ["first_seen", (r: LibraryRow) => r.firstSeenAt],
    ["last_activity", (r: LibraryRow) => r.lastActivityAt],
    ["channels", (r: LibraryRow) => Object.entries(r.channels).map(([k, v]) => `${k}:${v}`)],
    ["flows", (r: LibraryRow) => r.flows],
    ["plans", (r: LibraryRow) => r.plans],
    ["packages_generated", (r: LibraryRow) => r.packagesGenerated],
    ["app_builds", (r: LibraryRow) => r.appBuilds],
    ["improvements", (r: LibraryRow) => r.improvements],
    ["verified", (r: LibraryRow) => r.verified],
    ["delivered_unverified", (r: LibraryRow) => r.deliveredUnverified],
    ["failed", (r: LibraryRow) => r.failed],
    ["not_covered", (r: LibraryRow) => r.notCovered],
    ["in_progress", (r: LibraryRow) => r.inProgress],
    ["checks_passed", (r: LibraryRow) => r.checksPassed],
    ["checks_total", (r: LibraryRow) => r.checksTotal],
    ["requirements_met", (r: LibraryRow) => r.requirementsMet],
    ["requirements_open", (r: LibraryRow) => r.requirementsOpen],
    ["capabilities", (r: LibraryRow) => r.capabilities],
    ["components", (r: LibraryRow) => r.components],
    ["avg_seconds_to_verified", (r: LibraryRow) => r.avgSecondsToVerified],
    ["downloads", (r: LibraryRow) => r.downloads],
    ["pull_requests", (r: LibraryRow) => r.pullRequests],
    ["github_pushes", (r: LibraryRow) => r.githubPushes],
    ["deploys", (r: LibraryRow) => r.deploys],
    ["local_applies", (r: LibraryRow) => r.localApplies],
    ["uncovered_requests", (r: LibraryRow) => r.uncoveredRequests],
    ["ai_apps", (r: LibraryRow) => r.aiApps],
    ["ai_calls", (r: LibraryRow) => r.aiCalls],
    ["ai_input_tokens", (r: LibraryRow) => r.aiInputTokens],
    ["ai_output_tokens", (r: LibraryRow) => r.aiOutputTokens],
    ["ai_spent_usd", (r: LibraryRow) => r.aiSpentUsd],
  ] as [string, (r: never) => unknown][],
  orchestration: [
    ["owner_id", (r: OrchestrationRow) => r.ownerId],
    ["kind", (r: OrchestrationRow) => r.kind],
    ["email", (r: OrchestrationRow) => r.email],
    ["name", (r: OrchestrationRow) => r.name],
    ["company", (r: OrchestrationRow) => r.company],
    ["use_case", (r: OrchestrationRow) => r.useCase],
    ["signup_at", (r: OrchestrationRow) => r.signupAt],
    ["signups", (r: OrchestrationRow) => r.signups],
    ["last_activity", (r: OrchestrationRow) => r.lastActivityAt],
    ["requests", (r: OrchestrationRow) => r.requests],
    ["failed_requests", (r: OrchestrationRow) => r.failedRequests],
    ["model_calls", (r: OrchestrationRow) => r.modelCalls],
    ["input_tokens", (r: OrchestrationRow) => r.inputTokens],
    ["output_tokens", (r: OrchestrationRow) => r.outputTokens],
    ["latency_p50_ms", (r: OrchestrationRow) => r.latencyP50Ms],
    ["latency_p95_ms", (r: OrchestrationRow) => r.latencyP95Ms],
    ["cost_usd", (r: OrchestrationRow) => r.costUsd],
    ["frontier_reference_cost_usd", (r: OrchestrationRow) => r.referenceCostUsd],
    ["savings_usd", (r: OrchestrationRow) => r.savingsUsd],
    ["savings_pct", (r: OrchestrationRow) => r.savingsPct],
    ["trial_cap_usd", (r: OrchestrationRow) => r.trial.capUsd],
    ["trial_spent_usd", (r: OrchestrationRow) => r.trial.spentUsd],
    ["trial_remaining_usd", (r: OrchestrationRow) => r.trial.remainingUsd],
    ["trial_reached", (r: OrchestrationRow) => r.trial.reached],
    ["api_chat_requests", (r: OrchestrationRow) => r.bySurface.apiChat.requests],
    ["api_chat_cost_usd", (r: OrchestrationRow) => r.bySurface.apiChat.costUsd],
    ["orchestrate_requests", (r: OrchestrationRow) => r.bySurface.orchestrate.requests],
    ["orchestrate_cost_usd", (r: OrchestrationRow) => r.bySurface.orchestrate.costUsd],
    ["agent_requests", (r: OrchestrationRow) => r.bySurface.agent.requests],
    ["agent_cost_usd", (r: OrchestrationRow) => r.bySurface.agent.costUsd],
    ["mcp_requests", (r: OrchestrationRow) => r.bySurface.mcp.requests],
    ["mcp_cost_usd", (r: OrchestrationRow) => r.bySurface.mcp.costUsd],
  ] as [string, (r: never) => unknown][],
};

/** CSV of one view of the report (header + one line per row, CRLF). */
export function ownerReportCsv(report: OwnerReport, view: ReportView): string {
  const cols = COLUMNS[view];
  const rows: unknown[] =
    view === "people"
      ? report.people
      : view === "library"
        ? report.library.rows
        : report.orchestration.rows;
  return [
    cols.map(([h]) => h).join(","),
    ...rows.map((r) => cols.map(([, get]) => csvField(get(r as never))).join(",")),
  ]
    .join("\r\n")
    .concat("\r\n");
}

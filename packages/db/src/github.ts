import type pg from "pg";

/**
 * GitHub connection per workspace and repository integration jobs (PLAN §16 P5, ADR-0034). Tokens arrive here
 * already encrypted (AES-256-GCM, DELIVERY_TOKEN_KEY) and only `githubTokenEnc` returns the ciphertext — to the
 * server code that calls GitHub, never to a client.
 */

export interface GithubConnection {
  login: string;
  scopes: string;
  privateRepos: boolean;
  via: "oauth" | "token";
  connectedAt: string;
}

export async function saveGithubConnection(
  db: pg.Pool,
  c: {
    ownerId: string;
    tokenEnc: string;
    login: string;
    scopes: string;
    privateRepos: boolean;
    via: "oauth" | "token";
  },
): Promise<void> {
  await db.query(
    `INSERT INTO github_connections (owner_id, token_enc, login, scopes, private_repos, via)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_id) DO UPDATE SET token_enc = $2, login = $3, scopes = $4, private_repos = $5, via = $6,
       updated_at = now()`,
    [c.ownerId, c.tokenEnc, c.login, c.scopes, c.privateRepos, c.via],
  );
}

export async function githubConnection(
  db: pg.Pool,
  ownerId: string,
): Promise<GithubConnection | null> {
  const r = await db.query<GithubConnection>(
    `SELECT login, scopes, private_repos AS "privateRepos", via, updated_at AS "connectedAt"
     FROM github_connections WHERE owner_id = $1`,
    [ownerId],
  );
  return r.rows[0] ?? null;
}

/** The encrypted token, for server-side GitHub calls only. */
export async function githubTokenEnc(db: pg.Pool, ownerId: string): Promise<string | null> {
  const r = await db.query<{ token_enc: string }>(
    "SELECT token_enc FROM github_connections WHERE owner_id = $1",
    [ownerId],
  );
  return r.rows[0]?.token_enc ?? null;
}

/** Disconnect: deletes the connection and returns what is needed to revoke the grant at GitHub. */
export async function deleteGithubConnection(
  db: pg.Pool,
  ownerId: string,
): Promise<{ tokenEnc: string; via: "oauth" | "token" } | null> {
  const r = await db.query<{ token_enc: string; via: "oauth" | "token" }>(
    "DELETE FROM github_connections WHERE owner_id = $1 RETURNING token_enc, via",
    [ownerId],
  );
  const row = r.rows[0];
  return row ? { tokenEnc: row.token_enc, via: row.via } : null;
}

export interface OAuthStateRow {
  ownerId: string;
  verifierEnc: string;
  privateRepos: boolean;
  returnTo: string;
  viaTicket: boolean;
}

export async function createOAuthState(
  db: pg.Pool,
  s: OAuthStateRow & { stateHash: string },
): Promise<void> {
  await db.query("DELETE FROM github_oauth_states WHERE expires_at < now()");
  await db.query(
    `INSERT INTO github_oauth_states (state_hash, owner_id, verifier_enc, private_repos, return_to, via_ticket)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.stateHash, s.ownerId, s.verifierEnc, s.privateRepos, s.returnTo, s.viaTicket],
  );
}

/** One use: the state row is deleted as it is read; expired rows never match. */
export async function takeOAuthState(
  db: pg.Pool,
  stateHash: string,
): Promise<OAuthStateRow | null> {
  const r = await db.query<OAuthStateRow>(
    `DELETE FROM github_oauth_states WHERE state_hash = $1 AND expires_at > now()
     RETURNING owner_id AS "ownerId", verifier_enc AS "verifierEnc", private_repos AS "privateRepos",
       return_to AS "returnTo", via_ticket AS "viaTicket"`,
    [stateHash],
  );
  return r.rows[0] ?? null;
}

export async function createConnectTicket(
  db: pg.Pool,
  t: { ticketHash: string; ownerId: string; code: string; privateRepos: boolean },
): Promise<void> {
  await db.query("DELETE FROM github_connect_tickets WHERE expires_at < now()");
  await db.query(
    `INSERT INTO github_connect_tickets (ticket_hash, owner_id, code, private_repos) VALUES ($1, $2, $3, $4)`,
    [t.ticketHash, t.ownerId, t.code, t.privateRepos],
  );
}

/** An unused, unexpired ticket; `consume` marks it used atomically (a second use finds nothing). */
export async function connectTicket(
  db: pg.Pool,
  ticketHash: string,
  consume = false,
): Promise<{ ownerId: string; code: string; privateRepos: boolean } | null> {
  const r = consume
    ? await db.query<{ ownerId: string; code: string; privateRepos: boolean }>(
        `UPDATE github_connect_tickets SET used_at = now()
         WHERE ticket_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING owner_id AS "ownerId", code, private_repos AS "privateRepos"`,
        [ticketHash],
      )
    : await db.query<{ ownerId: string; code: string; privateRepos: boolean }>(
        `SELECT owner_id AS "ownerId", code, private_repos AS "privateRepos" FROM github_connect_tickets
         WHERE ticket_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [ticketHash],
      );
  return r.rows[0] ?? null;
}

// ── repository integration jobs ──────────────────────────────────────────────────────────────────────────

export interface RepoIntegrationRow {
  id: string;
  build_id: string;
  owner_id: string;
  repo: string;
  base: string | null;
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  state: string | null;
  branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  draft: boolean | null;
  result: Record<string, unknown>;
  error: { code: string; message: string; action: string; resume?: string } | null;
  attempts: number;
  created_at: string;
  finished_at: string | null;
}

/** Queues an integration; an active one for the same flow and repository is returned instead of a duplicate. */
export async function enqueueRepoIntegration(
  db: pg.Pool,
  j: { id: string; buildId: string; ownerId: string; repo: string; base: string | null },
): Promise<{ row: RepoIntegrationRow; created: boolean }> {
  const ins = await db.query<RepoIntegrationRow>(
    `INSERT INTO repo_integrations (id, build_id, owner_id, repo, base) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING *`,
    [j.id, j.buildId, j.ownerId, j.repo, j.base],
  );
  if (ins.rows[0]) return { row: ins.rows[0], created: true };
  const cur = await db.query<RepoIntegrationRow>(
    `SELECT * FROM repo_integrations WHERE build_id = $1 AND repo = $2 AND status IN ('queued', 'running')`,
    [j.buildId, j.repo],
  );
  if (!cur.rows[0]) throw new Error("integration could not be queued");
  return { row: cur.rows[0], created: false };
}

export async function listRepoIntegrations(
  db: pg.Pool,
  buildId: string,
  ownerId: string,
): Promise<RepoIntegrationRow[]> {
  const r = await db.query<RepoIntegrationRow>(
    `SELECT * FROM repo_integrations WHERE build_id = $1 AND owner_id = $2 ORDER BY created_at DESC LIMIT 20`,
    [buildId, ownerId],
  );
  return r.rows;
}

/** Latest integration per flow of a workspace (activity view). */
export async function latestRepoIntegrations(
  db: pg.Pool,
  ownerId: string,
): Promise<
  Pick<RepoIntegrationRow, "build_id" | "repo" | "pr_url" | "state" | "status" | "draft">[]
> {
  const r = await db.query<
    Pick<RepoIntegrationRow, "build_id" | "repo" | "pr_url" | "state" | "status" | "draft">
  >(
    `SELECT DISTINCT ON (build_id) build_id, repo, pr_url, state, status, draft
     FROM repo_integrations WHERE owner_id = $1 ORDER BY build_id, created_at DESC`,
    [ownerId],
  );
  return r.rows;
}

export async function claimRepoIntegration(
  db: pg.Pool,
  workerId: string,
): Promise<RepoIntegrationRow | null> {
  const r = await db.query<RepoIntegrationRow>(
    `UPDATE repo_integrations SET status = 'running', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
     WHERE id = (SELECT id FROM repo_integrations WHERE status = 'queued' ORDER BY created_at
                 FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [workerId],
  );
  return r.rows[0] ?? null;
}

export async function updateRepoIntegration(
  db: pg.Pool,
  id: string,
  f: Partial<
    Pick<
      RepoIntegrationRow,
      | "status"
      | "phase"
      | "state"
      | "branch"
      | "pr_url"
      | "pr_number"
      | "draft"
      | "result"
      | "error"
    >
  >,
): Promise<void> {
  const cols = Object.keys(f) as (keyof typeof f)[];
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  if (f.status === "done" || f.status === "failed") sets.push("finished_at = now()");
  await db.query(`UPDATE repo_integrations SET ${sets.join(", ")} WHERE id = $1`, [
    id,
    ...cols.map((c) =>
      c === "result" || c === "error" ? JSON.stringify(f[c] ?? null) : (f[c] ?? null),
    ),
  ]);
}

/** Jobs left `running` by a worker that stopped: back to the queue (at most 3 attempts), then failed. */
export async function requeueStaleRepoIntegrations(db: pg.Pool, minutes = 45): Promise<void> {
  await db.query(
    `UPDATE repo_integrations SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
       phase = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, claimed_by = NULL
     WHERE status = 'running' AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [String(minutes)],
  );
}

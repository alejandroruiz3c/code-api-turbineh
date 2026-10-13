-- Connect GitHub and integrate into the client's repository (PLAN §16 P5, ADR-0032).

-- One GitHub connection per workspace (owner). The token is AES-256-GCM encrypted with DELIVERY_TOKEN_KEY, never
-- returned by the API and never logged; "Disconnect GitHub" deletes the row and revokes the OAuth grant.
CREATE TABLE github_connections (
  owner_id      TEXT PRIMARY KEY,
  token_enc     TEXT        NOT NULL,
  login         TEXT        NOT NULL,
  scopes        TEXT        NOT NULL DEFAULT '',
  private_repos BOOLEAN     NOT NULL DEFAULT false,
  via           TEXT        NOT NULL CHECK (via IN ('oauth', 'token')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth in flight: only the SHA-256 of the state is stored (the state itself lives in the user's httpOnly cookie and
-- in GitHub's redirect), with the PKCE verifier encrypted. One use, ten minutes.
CREATE TABLE github_oauth_states (
  state_hash    TEXT PRIMARY KEY,
  owner_id      TEXT        NOT NULL,
  verifier_enc  TEXT        NOT NULL,
  private_repos BOOLEAN     NOT NULL DEFAULT false,
  return_to     TEXT        NOT NULL DEFAULT '/flows/new',
  via_ticket    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

-- `turbineh connect github`: a one-time link the CLI opens in a browser to run the same OAuth flow for its workspace.
-- Only the hash of the ticket is stored; the short code is shown in the terminal and on the page to confirm.
CREATE TABLE github_connect_tickets (
  ticket_hash   TEXT PRIMARY KEY,
  owner_id      TEXT        NOT NULL,
  code          TEXT        NOT NULL,
  private_repos BOOLEAN     NOT NULL DEFAULT false,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

-- Repository integration jobs: analyse → adapt → commit → draft pull request → verify in the sandbox → ready/draft.
CREATE TABLE repo_integrations (
  id          TEXT PRIMARY KEY,
  build_id    UUID        NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  owner_id    TEXT        NOT NULL,
  repo        TEXT        NOT NULL,
  base        TEXT,
  status      TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  phase       TEXT        NOT NULL DEFAULT 'queued',
  state       TEXT,
  branch      TEXT,
  pr_url      TEXT,
  pr_number   INTEGER,
  draft       BOOLEAN,
  result      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error       JSONB,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  claimed_by  TEXT,
  claimed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX repo_integrations_queue_idx ON repo_integrations (created_at) WHERE status = 'queued';
CREATE INDEX repo_integrations_build_idx ON repo_integrations (build_id, created_at DESC);
CREATE UNIQUE INDEX repo_integrations_one_active_idx ON repo_integrations (build_id, repo)
  WHERE status IN ('queued', 'running');

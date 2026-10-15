-- Platform database (catalog, builds, events). Embeddings: qwen3-embedding-8b reduced to 1024 dims.
CREATE EXTENSION IF NOT EXISTS vector;

-- discovered / evaluated packages from public registries (PLAN §3.7)
CREATE TABLE packages (
  id              BIGSERIAL PRIMARY KEY,
  ecosystem       TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  latest_version  TEXT,
  description     TEXT,
  keywords        TEXT[]      NOT NULL DEFAULT '{}',
  license         TEXT,
  repository_url  TEXT,
  homepage        TEXT,
  downloads       BIGINT,
  dependents      BIGINT,
  latest_release_at TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','evaluated')),
  advisories      INTEGER,
  source          TEXT        NOT NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  embedding       vector(1024),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ecosystem, name)
);
CREATE INDEX packages_embedding_idx ON packages USING hnsw (embedding vector_cosine_ops);

-- approved / evaluated components synced from catalog/components/*/component.yaml (git is the source of truth)
CREATE TABLE components (
  id          TEXT PRIMARY KEY,
  version     TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('discovered','evaluated','approved','deprecated')),
  category    TEXT        NOT NULL,
  provides    TEXT[]      NOT NULL,
  purl        TEXT        NOT NULL,
  license     TEXT        NOT NULL,
  manifest    JSONB       NOT NULL,
  card        TEXT        NOT NULL,
  embedding   vector(1024),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX components_provides_idx ON components USING gin (provides);
CREATE INDEX components_embedding_idx ON components USING hnsw (embedding vector_cosine_ops);

CREATE TABLE builds (
  id          UUID PRIMARY KEY,
  prompt      TEXT        NOT NULL,
  status      TEXT        NOT NULL,
  spec        JSONB,
  metrics     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE build_events (
  id        BIGSERIAL PRIMARY KEY,
  build_id  UUID        NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  phase     TEXT        NOT NULL,
  type      TEXT        NOT NULL,
  data      JSONB       NOT NULL DEFAULT '{}',
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX build_events_build_idx ON build_events (build_id, id);


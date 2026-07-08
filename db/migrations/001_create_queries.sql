CREATE TABLE IF NOT EXISTS queries (
  query TEXT PRIMARY KEY,
  count BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
  recent_count BIGINT NOT NULL DEFAULT 0 CHECK (recent_count >= 0),
  last_seen TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_queries_prefix
  ON queries (query text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_queries_count_desc
  ON queries (count DESC);

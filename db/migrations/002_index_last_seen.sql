-- Supports the index builder's "recently searched" source. Partial: only queries that users have
-- actually searched have last_seen set, so this stays small next to the 10M+ dataset rows.
CREATE INDEX IF NOT EXISTS idx_queries_last_seen
  ON queries (last_seen DESC)
  WHERE last_seen IS NOT NULL;

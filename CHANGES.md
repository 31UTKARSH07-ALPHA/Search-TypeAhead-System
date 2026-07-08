## Phase 1.1 — Monorepo structure
Status: done
Commit: 81aca96 chore: scaffold monorepo services
Notes: Created root npm workspaces, frontend shell, search-service, suggestion-service, batch-worker, and placeholder db/infra/shared-types folders. `npm run build` passes for all workspaces. npm install reported 2 dependency audit findings; deferred because they do not block the scaffold build.

## Phase 1.2 — Shared types package
Status: done
Commit: d96378b feat: add shared service contracts
Notes: Added `@typeahead/shared-types` with candidate, search, cache debug, and health response contracts. Wired the three backend services to the local package. `npm run build` passes.

## Phase 1.3 — Docker Compose skeleton
Status: done
Commit: 8a3ad5b chore: add compose skeleton
Notes: Added compose skeleton, nginx config, and Dockerfiles for frontend/search/suggestion/batch services. Verified `docker compose config`, `docker compose up --build -d`, healthy service containers, and nginx health routes from inside nginx with `wget http://127.0.0.1/{search,suggest,batch}/health`. Host-side curl to localhost:8080 was unavailable from the sandbox, but container-internal nginx routing passed.

## Phase 1.4 — nginx routing config
Status: done
Commit: 57a5b0f chore: route api paths through nginx
Notes: Added nginx routing for `/suggest`, `/cache/debug`, and `/search`. Verified through nginx with host-side curl: `/suggest` and `/cache/debug` include `X-Typeahead-Upstream: suggestion-service`; `/search` includes `X-Typeahead-Upstream: search-service`. They return 404 until the real endpoints are implemented in later phases, but upstream routing is correct. `npm run build` passes and `nginx -t` passes.

## Phase 2.1 — Schema and migrations
Status: done
Commit: 017c2e0 feat: add query schema migration
Notes: Added `db/migrations/001_create_queries.sql` with `queries(query TEXT PRIMARY KEY, count BIGINT, recent_count BIGINT, last_seen TIMESTAMPTZ)`, non-negative count checks, prefix `text_pattern_ops` index, and count-desc index. Mounted migrations into Postgres init directory for clean starts. Verified `docker compose config`, `npm run build`, applied the migration to the existing Postgres container, and inspected columns/indexes with `psql`.

## Phase 2.2 — Dataset selection and loader
Status: done
Commit: bd57d86 feat: add wikimedia dataset loader
Notes: Downloaded Wikimedia Pageviews hourly dump `pageviews-20260501-000000.gz` locally under ignored `data/raw/`. Added `npm run dataset:load`, a streaming gzip TypeScript loader, and non-Markdown dataset source notes in `db/DATASET.txt`. Loader filters project `en`, normalizes page titles to lowercase query strings, aggregates counts, and bulk upserts to Postgres. Changed Docker Postgres host port to `55432` because local Postgres was already listening on `127.0.0.1:5432`. Verified loader inserted 150000 rows and `npm run build` passes.

## Phase 2.3 — Verify indexing
Status: done
Commit: 5070ac9 test: record prefix index verification
Notes: Ran `EXPLAIN ANALYZE` against the loaded 150000-row dataset. Selective prefix `amos%` used `idx_queries_prefix` with execution time around 0.147 ms and returned 10 rows. Common prefixes may use `idx_queries_count_desc` because Postgres can satisfy `ORDER BY count DESC LIMIT 10` faster by scanning popular rows and filtering. Added `db/INDEX_VERIFICATION.txt` with the plan summary for later reporting. `npm run build` passes.

## Phase 3.1 — Candidate fetch query
Status: done
Commit: a21ba43 feat: add suggestion candidate repository
Notes: Added suggestion-service config, `QueryRepository` interface, and `PostgresQueryRepository` implementation using `pg`. Repository fetches raw prefix candidates from Postgres ordered by `count DESC`. Added service `DATABASE_URL` in compose. `docker compose config` and `npm run build` pass.

## Phase 3.2 — Ranking strategy module
Status: done
Commit: 54886ff feat: add frequency ranking strategy
Notes: Added `RankingStrategy` interface, `FrequencyStrategy`, and registry scaffolding. Frequency ranking assigns `score = count` and sorts by score descending with query lexicographic tie-breaker. Suggestion-service build passes.

## Phase 3.3 — GET /suggest endpoint
Status: done
Commit: d2a4fe1 feat: expose database-backed suggestions
Notes: Added shared `SuggestResponse`, prefix normalization, and Express `/suggest` route. Handles missing, short (<3), too-long (>50), mixed-case, and no-match prefixes with 200 responses and empty suggestions where appropriate. Uses Postgres candidate repository plus frequency ranking and returns top 10 suggestions. Verified through nginx with `q=ann`, `q=ANN`, `q=an`, missing `q`, no-match prefix, long prefix, and unsupported `rank=recency` fallback to frequency. `npm run build` passes.

## Phase 4.1 — Search input with debounce
Status: done
Commit: 37b62ad feat: add debounced search input
Notes: Replaced the placeholder frontend with the real search workspace, added shared-type-aware suggestion fetch client, and added a 250ms debounced suggestion hook that only calls `/suggest` for normalized prefixes between 3 and 50 characters. `npm run build` passes.

## Phase 4.2 — Suggestion dropdown with keyboard navigation
Status: done
Commit: 0fc34d0 feat: add suggestion dropdown navigation
Notes: Added listbox-style suggestion dropdown, count display, mouse selection, and keyboard navigation with ArrowDown/ArrowUp/Enter/Escape. `npm run build` passes.

## Phase 4.3 — Loading and error states
Status: done
Commit: be801c2 feat: add suggestion UI states
Notes: Added dropdown-area loading, error, and no-match states. Fixed the frontend Dockerfile to include the shared-types workspace so container builds match local workspace builds. Verified `npm run build`, `docker compose up -d --build frontend nginx`, frontend HTTP 200 through nginx, healthy frontend/suggestion/postgres containers, and `/suggest?q=ann` through nginx. In-app browser was unavailable in this session, so visual/keyboard behavior was verified by build and HTTP checks rather than browser automation.

## Phase 5.1 — Dummy search endpoint
Status: done
Commit: 3dd1f00 feat: add dummy search endpoint
Notes: Added `POST /search` in search-service with query normalization/validation. Valid requests return `{ "message": "Searched" }`; missing query returns 400. Verified through nginx with curl after rebuilding search-service and reloading nginx. `npm run build` passes.

## Phase 5.2 — Synchronous count update
Status: done
Commit: 9e2a47e feat: persist submitted search counts
Notes: Added search-service config, `QueryCountRepository` abstraction, and Postgres implementation. `POST /search` now synchronously upserts normalized queries, incrementing existing counts and inserting new queries with count 1. Verified existing `anne hathaway` count changed 410 to 411, new `codex typeahead verification` row was inserted, and the new row immediately appeared in `/suggest?q=codex`. `npm run build` and `docker compose config` pass.

## Phase 5.3 — Frontend search submission
Status: done
Commit: ca6f5e7 feat: wire frontend search submission
Notes: Added typed frontend `POST /search` client, form submission on Enter/button, submitting state, and visible success/error response. Preserved Enter-to-select behavior when a dropdown option is active. Verified `npm run build`, rebuilt the frontend container, confirmed the rendered form/button through nginx, received `{ "message": "Searched" }`, and confirmed `frontend submission verification` persisted with count 1. In-app browser remained unavailable, so interactive behavior was verified by build, rendered HTML, API, and database checks.

## Phase 6.1 — Kafka in Docker Compose
Status: done
Commit: a4f3c88 chore: add kafka queue infrastructure
Notes: Added Kafka 7.7.1 with Zookeeper and a one-shot `kafka-init` service. Automatic topic creation is disabled; the initializer explicitly creates `search-events` with one partition and replication factor one. Verified `docker compose config`, healthy Kafka/Zookeeper containers, successful initializer exit, and topic metadata showing an in-sync leader.

## Phase 6.2 — Producer in search-service
Status: done
Commit: 06fadce feat: publish searches to kafka
Notes: Replaced the synchronous Postgres upsert path with a KafkaJS producer behind a `SearchEventPublisher` interface. Search-service no longer has `DATABASE_URL`, `pg`, or query-count repository code. Verified `POST /search` returned `{ "message": "Searched" }`, Kafka topic offset moved from 0 to 1, and Postgres remained unchanged for `phase six producer verification`, which is expected until Phase 7 aggregation.

## Phase 6.3 — Consumer skeleton in batch-worker
Status: done
Commit: b6c7748 feat: consume search events in batch worker
Notes: Added KafkaJS consumer wiring in batch-worker behind a small `KafkaSearchEventConsumer` class, with broker/topic/group config and defensive parsing for malformed payloads. No aggregation or database writes were added. Verified `POST /search` for `phase six consumer verification` returned `Searched`, Kafka topic offset moved from 1 to 2, batch-worker logged `Consumed search event`, batch health returned ok, and Postgres remained unchanged. `npm run build` and `docker compose config` pass.

## Phase 7.1 — In-memory aggregation buffer
Status: done
Commit: a30e657 feat: aggregate consumed search events
Notes: Added `SearchAggregationBuffer` in batch-worker to accumulate consumed Kafka events into a `Map<query, count>`. The consumer now feeds the buffer and logs raw vs unique counts, but does not flush to Postgres yet. `npm run build` passes.

## Phase 7.2 — Flush triggers
Status: done
Commit: a0b0d67 feat: flush aggregated searches to postgres
Notes: Added configurable timer/size flush triggers, a batch-worker Postgres repository, DB env/dependency wiring, and shutdown flushing. Each flush drains aggregated events and issues one upsert per unique query inside a transaction, restoring the drained batch if the transaction fails. `docker compose config --quiet` and `npm run build` pass.

## Phase 7.3 — Write-reduction logging
Status: done
Commit: fc287fb feat: log batch write reduction
Notes: Flush logs now report `rawEventsConsumed`, `upsertsIssued`, `writesAvoided`, and `writeReductionFactor`, with per-event buffer logs removed. Verified five identical `POST /search` submissions through nginx produced one timer flush with rawEventsConsumed=5, upsertsIssued=1, writesAvoided=4, writeReductionFactor=5, and Postgres count=5 for `phase seven reduction verification`. `docker compose config --quiet` and `npm run build` pass.

## Phase 8.1 — Cluster sandbox
Status: done
Commit: f23b3cc chore: add redis cluster sandbox
Notes: Added `docker-compose.cluster-sandbox.yml` with six Redis 7.2 nodes, named volumes, and an explicit sandbox project name. Verified compose config, started the sandbox, ran `redis-cli --cluster create ... --cluster-replicas 1 --cluster-yes`, confirmed all 16384 slots covered via `CLUSTER NODES` / `CLUSTER SLOTS`, and confirmed hash-tag behavior: `{node1}:test` and `{node1}:other-prefix` both mapped to slot 3662. Host port bindings were intentionally omitted to avoid local port conflicts; verification runs through `docker compose exec`.

## Phase 8.2 — Cluster in main compose
Status: done
Commit: fd89307 chore: add redis cluster to compose
Notes: Added six Redis 7.2 cluster nodes and an idempotent `redis-cluster-init` job to the main compose stack. Verified `docker compose config --quiet`, started the Redis services, confirmed initializer created three masters with three replicas, and checked `cluster_state:ok`, `cluster_slots_assigned:16384`, `cluster_known_nodes:6`, and `cluster_size:3`.

## Phase 8.3 — Cluster client in suggestion-service
Status: done
Commit: dd68685 feat: connect suggestion service to redis cluster
Notes: Added `ioredis`, Redis Cluster node config parsing, a `RedisClusterClient` wrapper, and suggestion-service startup read/write verification. The service depends on `redis-cluster-init` and starts only after writing and reading `typeahead:redis-cluster:startup-check`. Verified `npm run build`, `docker compose config --quiet`, rebuilt the service, confirmed the verification log, read the startup-check key through Redis Cluster, confirmed `cluster_state:ok`, and smoke-tested `/suggest?q=ann` plus short-prefix `/suggest?q=an` through nginx.

## Phase 9.1 — Hash ring implementation
Status: done
Commit: a139963 feat: add consistent hash ring
Notes: Added a deterministic SHA-256-based consistent hash ring with configurable logical bucket count and virtual-node count. Suggestion-service now constructs the ring from config, but Redis key generation and request routing remain for later Phase 9 subphases. `npm run build` passes.

## Phase 9.2 — Hash-tag key builder
Status: done
Commit: d23ecfe feat: build hash tagged cache keys
Notes: Added `SuggestionCacheKeyBuilder` to combine the app-level ring bucket with Redis hash tags, producing keys shaped like `{nodeN}:suggest:<prefix>`. No read-path behavior changed yet. `npm run build` passes.

## Phase 9.3 — Cache-as-index read path
Status: done
Commit: a77155d feat: read suggestions from cache index
Notes: Replaced database-backed `/suggest` reads with Redis Cluster cache-index reads using the ring-derived hash-tagged key. True misses return empty suggestions with no DB fallback, matching the architecture doc; Phase 10 will populate the index. Existing ranking still runs against cached candidates when present. `npm run build` passes.

## Phase 9.4 — `/cache/debug` endpoint
Status: done
Commit: a60e498 feat: expose cache debug routing
Notes: Added `/cache/debug?prefix=` with normalized prefix, app ring bucket, hash-tagged Redis key, Redis Cluster slot, owner node, and hit/miss status. Verified rebuilt stack through nginx: `/suggest?q=ann` returned empty on true miss, `/cache/debug?prefix=ann` returned `{node11}:suggest:ann`, slot 4336, and hit=false. Inserted a temporary Redis entry with TTL on that exact key, then `/suggest?q=ann` returned the cached candidate and `/cache/debug` reported hit=true with the same slot. `npm run build` and `docker compose config --quiet` pass.

## Phase 10.1 — Index builder job
Status: done
Commit: 487da3c feat: compute prefix cache index
Notes: Added suggestion-service `index:build` job that scans top Postgres queries, computes bounded prefix entries (3-50 chars, top 50 candidates), and logs source/prefix counts. Verified `npm run build`; with `INDEX_SOURCE_ROW_LIMIT=1000` the builder produced 12756 prefix entries from 1000 source rows. Redis writes/versioning deferred to Phase 10.2.

## Phase 10.2 — Versioned index publish
Status: done
Commit: 67ffcd7 feat: publish versioned suggestion index
Notes: Added versioned Redis cache keys, a current-version pointer, hash-tag-grouped cluster pipeline writes, and an `index-builder` compose job. `/suggest` reads the current pointer before looking up cache entries, and `/cache/debug` reports the active index version. Verified `npm run build`, `docker compose config --quiet`, limited publish with `INDEX_SOURCE_ROW_LIMIT=1000` writing 12756 entries, `/suggest?q=ann` returning cached results, and `/cache/debug?prefix=ann` reporting hit=true for version `v20260620T130735159Z`.

## Phase 10.3 — Startup readiness gate
Status: done
Commit: c0e1864 feat: gate suggestions on warm cache
Notes: Added cache-ready wait config and made suggestion-service wait for a current Redis index version before calling `app.listen`. Compose now runs `index-builder` to completion before starting suggestion-service. Verified full compose startup built 1885059 entries from 150003 source rows, suggestion-service logged `Suggestion cache index is ready` before listening, `/suggest?q=ann` returned cached suggestions, and `/cache/debug?prefix=ann` reported hit=true. Also rebuilt the index while serving; API continued reading old version `v20260620T130959433Z` during the write, then moved to new version `v20260620T131047307Z` after pointer flip.

## Phase 11.1 — Recency signal maintenance
Status: done
Commit: 6cd039d feat: maintain recency search counts
Notes: Batch-worker flushes now increment `recent_count` by the aggregated batch count and refresh `last_seen` while still incrementing all-time `count`. Verified `npm run build`, `docker compose config --quiet`, rebuilt batch-worker, submitted repeated searches through nginx after force-recreating nginx to refresh upstream DNS, and confirmed Postgres row `phase eleven recency verification` had `count=3`, `recent_count=3`, and non-null `last_seen`.

## Phase 11.2 — Recency and combined strategies
Status: done
Commit: 1616b16 feat: add recency ranking strategies
Notes: Added `RecencyStrategy` using exponentially decayed `recentCount` based on `lastSeen`, plus `CombinedStrategy` using `log1p(count)` with a weighted recency boost. Registered all three ranking modes while keeping cache entries ranking-agnostic raw candidates. Verified `npm run build`.

## Phase 11.3 — Rank query parameter and cached ranking views
Status: done
Commit: a6043eb feat: serve cached ranking modes
Notes: `GET /suggest` now accepts `rank=frequency|recency|combined`, with unsupported values falling back to frequency. The index builder stores the union of top candidates needed by all ranking modes per prefix while keeping cache entries as raw candidate data. Reduced default index source scan to 100000 rows and per-mode cached candidates to 10 to match the assignment dataset/API size under local Docker memory limits. Added TTL for versioned cache entries so old index versions expire after 24 hours. Verified `npm run build`, `docker compose config --quiet`, a normal `index-builder` publish (`sourceQueryCount=100000`, `writtenEntryCount=1393036`, `indexEntryTtlSeconds=86400`), healthy suggestion-service/nginx, cache debug hit for `rankdemo`, fallback for unsupported rank, and distinct side-by-side orderings for frequency, recency, and combined.

## Phase 12.1 — Trending endpoint
Status: done
Commit: 5fbc311 feat: expose trending searches
Notes: Added shared `TrendingResponse`, a Postgres candidate query for rows with `recent_count > 0`, and `GET /trending` in suggestion-service using the existing recency ranking strategy. Routed `/trending` through nginx. Verified `npm run build`, `docker compose config --quiet`, rebuilt suggestion-service/nginx, and confirmed `curl http://localhost:8080/trending` returns recency-ranked results through nginx.

## Phase 12.2 — Frontend trending section
Status: done
Commit: 36f43f4 feat: show trending searches
Notes: Added frontend `/trending` client and a dedicated Trending Searches section with loading, error, empty, and clickable row states. The section loads on mount and refreshes shortly after successful search submission to reflect the eventual batch update path. Verified `npm run build`, rebuilt frontend/nginx containers, confirmed `/trending` returns data through nginx, and confirmed the rendered root page includes the Trending Searches section.

## Phase 13.1 — JMeter test plan
Status: done
Commit: 1f994ce test: add jmeter load plan
Notes: Added `performance/jmeter/typeahead-load-test.jmx` with separate typeahead and search-submission thread groups targeting nginx at `localhost:8080`, using a 18:2 thread split for the documented 90:10 read/write mix and a CSV query source. Added `performance/jmeter/queries.csv` seed data and `performance/results/.gitkeep` for later JTL output. Verified the JMX is valid XML with `xmllint --noout`, `npm run build`, and `docker compose config --quiet`. Follow-up fix commit `1503b1a fix: correct jmeter query inputs` replaced fragile Groovy prefix generation with explicit CSV prefixes and ignored local failed-run JMeter outputs.

## Phase 13.2 — Baseline performance run
Status: done
Commit: a69d9d8 test: record baseline performance run
Notes: Installed Apache JMeter 5.6.3 with Homebrew and ran the corrected plan outside the sandbox because sandboxed localhost sockets failed with `java.net.SocketException: Operation not permitted`. Full baseline completed 2000 samples with 0 errors: total p95=8ms, p99=10.95ms, mean=4.83ms; `/suggest` p95=8ms, p99=11ms, mean=4.62ms over 1800 samples; `/search` p95=9ms, p99=10ms, mean=6.69ms over 200 samples. Cache debug check across 62 CSV prefixes reported 20 hits and 42 misses, hit rate 32.26%. Batch-worker flush logs for the run window reported 200 raw search events, 186 upserts, 14 writes avoided, write-reduction factor 1.08. Result artifacts are `performance/results/typeahead-baseline-complete.jtl`, `performance/results/baseline-statistics.json`, and `performance/results/baseline-summary.json`.

## Phase 13.3 — Document performance results
Status: done
Commit: 56cc778 docs: add performance report
Notes: Added a README performance report section with the JMeter baseline setup, result artifact paths, latency table, cache hit-rate numbers, and batch write-reduction summary. Verified README numbers against `performance/results/baseline-summary.json`.

## Phase 14.1 — README
Status: done
Commit: 3debe6f docs: add setup instructions
Notes: Expanded README with project purpose, prerequisites, install/build commands, dataset source and loader command, full-stack compose startup, index rebuild command, Redis Cluster sandbox commands, and local URLs. Verified `npm run build` and `docker compose config --quiet`.

## Phase 14.2 — API documentation
Status: done
Commit: a13f10d docs: document api endpoints
Notes: Added README API documentation for `GET /suggest`, `POST /search`, `GET /cache/debug`, `GET /trending`, and health checks with example requests/responses and rank-mode behavior. Verified `npm run build` and `docker compose config --quiet`.

## Phase 14.3 — Screenshots and demo
Status: done
Commit: 10961d3 docs: add demo evidence
Notes: Added `npm run demo:capture`, a Chrome DevTools Protocol capture script, demo screenshots for trending, suggestions, and search submission, plus `rankdemo` API JSON outputs for frequency, recency, and combined ranking modes. Verified `npm run build`, `docker compose config --quiet`, `npm run demo:capture`, and manually inspected the screenshots.

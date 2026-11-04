# Search Typeahead System

A distributed search-autocomplete system: start typing in the search box and the top 10 matching queries come back in single-digit milliseconds, like Google's suggestion dropdown.

The system is built around one observation: **people type far more often than they search.** Every keystroke is a read; only pressing Enter is a write. So the read path is made as fast as possible (precomputed suggestions in Redis, no database on the hot path), and the write path is allowed to be slow and batched.

**Highlights**

- **p95 8 ms / p99 11 ms** on `/suggest` (JMeter, 2,000 samples, 0 errors)
- **Kafka-buffered writes**: repeated searches are aggregated in memory and flushed as one upsert per query, so 5 identical searches become 1 database write
- **Versioned, atomically swapped index**: users never see a half-built index
- **Hand-rolled consistent-hash ring** with virtual nodes, steering data placement on a real 6-node Redis Cluster via hash tags
- **Pluggable ranking**: frequency, recency (exponential decay), or a combination of the two
- **At-least-once event processing**: Kafka offsets are committed only after the counts are saved to Postgres

---

## Architecture

```mermaid
flowchart LR
    U[Browser<br/>Next.js UI] -->|GET /suggest| N[nginx]
    U -->|POST /search| N

    N -->|/suggest, /trending| SG[Suggestion Service]
    N -->|/search| SS[Search Service]

    SS -->|produce event| K[(Kafka<br/>search-events)]
    K -->|consume| BW[Batch Worker]
    BW -->|batched UPSERT| PG[(PostgreSQL<br/>source of truth)]

    PG -->|every 5 min| IB[Index Builder]
    IB -->|write new version,<br/>then swap pointer| RC[(Redis Cluster<br/>serving index)]

    SG -->|lookup prefix| RC
```

The system has three independent flows.

### 1. Write path: someone presses Search

```
Browser → nginx → Search Service → Kafka → Batch Worker → PostgreSQL
```

1. **Search Service** publishes a `{query, searchedAt}` event to Kafka and replies `"Searched"` immediately. The user never waits on the database.
2. **Batch Worker** consumes events and counts them in memory (`"iphone" ×5, "samsung" ×2`).
3. Every 2 seconds, or when 100 unique queries have built up, it **flushes** to Postgres with one `INSERT ... ON CONFLICT DO UPDATE` per unique query.
4. Only **after** that write succeeds does it commit the Kafka offsets. If the worker crashes mid-batch, Kafka redelivers the events on restart, so nothing is lost.

> Analogy: a shopkeeper doesn't walk to the bank after every sale. They collect the day's cash and deposit it once.

### 2. Index path: precomputing suggestions

```
PostgreSQL → Index Builder → Redis Cluster (new version) → swap "current version" pointer
```

Every 5 minutes, the **Index Builder**:

1. Loads its **source queries**: the top N queries by all-time count, **plus** every query searched in the last 24 hours. Without the second part, a new query could never enter the index until its total count beat long-established queries.
2. Generates every prefix of every query (`iphone` → `iph`, `ipho`, `iphon`, `iphone`) and keeps the best candidates per prefix for each ranking mode.
3. Writes all entries under a **new version key** (e.g. `v20261104T203802797Z`).
4. Once everything is written, flips a single pointer key to the new version. This swap is atomic: readers see the old index or the new one, never a mix.
5. After a 5-second grace period (so in-flight requests finish), deletes the previous version's keys.

### 3. Read path: someone types

```
Browser (250 ms debounce) → nginx → Suggestion Service → Redis Cluster → rank → top 10
```

1. The frontend waits **250 ms** after the last keystroke, so typing "iphone" quickly sends one request, not six.
2. The prefix is normalized (lowercased, whitespace collapsed) and must be 3–50 characters.
3. The service reads the current index version, builds the cache key, and fetches the candidates from Redis.
4. The selected **ranking strategy** sorts the candidates and the top 10 are returned.
5. **No database call.** A cache miss means no query starts with that prefix; there is no database fallback.

---

## Key design decisions

### Consistent hashing, layered on Redis Cluster

Redis Cluster already shards keys by hashing them into 16,384 slots. To make the hand-built ring actually control placement (instead of being overridden by Redis), the ring decides a **logical bucket**, and that bucket becomes a Redis **hash tag**:

```
prefix "iph"  →  ring.getBucket("iph") = "node1"  →  key "{node1}:suggest:<version>:iph"
```

Redis hashes only the part inside `{}`, so every prefix the ring assigns to `node1` lands on the same physical node.

| Layer | Decides | How |
| --- | --- | --- |
| Our ring (`consistentHashRing.ts`) | Which logical bucket a prefix belongs to | SHA-256 hash, 16 buckets × 128 virtual nodes, binary search on a sorted ring |
| Redis Cluster | Which physical node owns that bucket | CRC16 of the hash tag → slot → master |

**Why a ring instead of `hash % N`?** With modulo, changing N remaps almost every key. With a ring, adding or removing a bucket moves only about 1/N of the keys.

**Why virtual nodes?** With one point per bucket, the gaps on the ring are uneven and one bucket ends up owning most of the keys. Many points per bucket smooth the distribution.

`GET /cache/debug?prefix=iph` shows both decisions side by side: the ring's bucket, the Redis slot, and the physical node.

### The cache *is* the index (no cache-aside)

Most caches load data lazily and fall back to the database on a miss. Here, Redis holds the **complete, precomputed** serving index, so the database is never on the read path. The trade-offs are accepted on purpose:

- **Freshness lag:** a new search becomes suggestable after the next rebuild (at most about 5 minutes), not instantly.
- **Cold start:** the suggestion service waits until the first index is published before serving traffic.
- **Memory:** every indexed prefix's candidates must be in memory.

### Ranking strategies (Strategy pattern)

| Mode | Score | Behaviour |
| --- | --- | --- |
| `frequency` (default) | `count` | All-time popular queries first |
| `recency` | `recentCount × e^(−age / 24h)` | Recently active queries first; a query last seen a day ago keeps ~37% of its score |
| `combined` | `ln(1 + count) + 0.1 × recency` | Long-term popularity, nudged by recent spikes; the log stops all-time giants from always winning |

Each strategy is its own class behind a `RankingStrategy` interface, so adding a new mode doesn't change existing code. Candidates are stored without ranking applied, and sorting happens at request time.

### Trade-offs, stated explicitly

- **Stale reads are fine.** A query's count can lag reality by one flush plus one rebuild cycle.
- **At-least-once, not exactly-once.** If Postgres commits but the Kafka offset commit then fails, those events are replayed and counted twice. Over-counting a few searches is preferred to losing them.
- **The ring's bucket count is fixed.** If the number of Redis masters changes, Redis reshards slots itself, but the ring doesn't automatically rebalance its buckets.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Router | nginx (path-based routing) |
| Services | Node.js, Express, TypeScript (npm workspaces with shared types) |
| Queue | Apache Kafka + ZooKeeper |
| Primary store | PostgreSQL 16 |
| Serving index | Redis Cluster (3 masters + 3 replicas) via `ioredis` |
| Infra | Docker Compose |
| Load testing | Apache JMeter |

See [`STACK.md`](STACK.md) for why each piece was chosen and what was ruled out, and [`ARCHITECURE.md`](ARCHITECURE.md) for the full design write-up.

---

## Project structure

```
├── frontend/                     Next.js UI: search box, suggestions, trending, keyboard nav
│   └── hooks/useDebouncedSuggestions.ts   250 ms debounce + request cancellation
├── services/
│   ├── search-service/           POST /search → publish to Kafka
│   ├── batch-worker/             Kafka consumer → in-memory aggregation → batched upserts
│   │   └── src/aggregation/      SearchAggregationBuffer, SearchBatchFlusher
│   └── suggestion-service/       GET /suggest, /trending, /cache/debug
│       ├── src/cache/            consistent-hash ring, key builder, Redis Cluster client
│       ├── src/ranking/          frequency / recency / combined strategies
│       └── src/index-builder/    periodic prefix-index build + versioned publish
├── packages/shared-types/        Types shared across all services
├── db/
│   ├── migrations/               Table + indexes (run automatically on a fresh database)
│   └── scripts/                  Dataset loaders (Wikimedia pageviews, ORCAS)
├── infra/nginx/default.conf      Routing rules
└── docker-compose.yml            Full stack: 17 containers
```

---

## Running locally

**Prerequisites:** Docker Desktop and Node.js 20+. The stack runs 17 containers (Kafka, a 6-node Redis Cluster, and more), so give Docker a generous memory allowance.

```bash
# 1. Install dependencies (needed for the dataset loader)
npm install

# 2. Start Postgres first so you can load data
docker compose up -d postgres

# 3. Load a dataset (see "Dataset" below), e.g. Wikimedia pageviews:
DATABASE_URL=postgres://typeahead:typeahead@localhost:55432/typeahead npm run dataset:load

# 4. Start everything
docker compose up --build -d
```

Then open **http://localhost:8081**.

Watch the index being built:

```bash
docker compose logs -f index-builder
# {"message":"Published suggestion index", ...}
# {"message":"Deleted stale suggestion index versions", ...}
```

| URL | What |
| --- | --- |
| http://localhost:8081 | App (through nginx) |
| http://localhost:3001 | Frontend directly |
| `localhost:55432` | PostgreSQL (`typeahead` / `typeahead`) |

### Dataset

Two loaders are included. Both write into the same `queries(query, count, recent_count, last_seen)` table:

| Dataset | Command | Size |
| --- | --- | --- |
| [Wikimedia pageviews](https://dumps.wikimedia.org/other/pageviews/): page titles with view counts | `npm run dataset:load` (file at `data/raw/pageviews-*.gz`) | 150K rows by default (`DATASET_LIMIT`) |
| [ORCAS](https://microsoft.github.io/msmarco/ORCAS.html): real Bing search queries from MS MARCO | `npm run dataset:load:orcas` (file at `data/raw/orcas.tsv.gz`) | ~10.4M distinct queries |

The ORCAS loader streams the multi-GB file into a staging table and lets Postgres do the `GROUP BY`, so Node never holds all the queries in memory.

---

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/suggest?q=<prefix>&rank=<frequency\|recency\|combined>` | Top 10 suggestions for a prefix |
| `POST` | `/search` with body `{"query": "..."}` | Records a search; returns `{"message":"Searched"}` |
| `GET` | `/trending` | Top 10 recently active queries, ranked by recency |
| `GET` | `/cache/debug?prefix=<prefix>` | Ring bucket, Redis slot/node, and hit/miss for a prefix |
| `GET` | `/{search,suggest,batch}/health` | Per-service health checks |

```bash
curl "http://localhost:8081/suggest?q=new&rank=frequency"
# {"prefix":"new","rank":"frequency","suggestions":[{"query":"news","count":199,...}, ...]}

curl -X POST http://localhost:8081/search -H 'content-type: application/json' -d '{"query":"openai sora"}'
# {"message":"Searched"}
```

---

## Configuration

Key environment variables (defaults in brackets):

| Variable | Service | Purpose |
| --- | --- | --- |
| `FLUSH_INTERVAL_MS` [2000] | batch-worker | Flush the aggregation buffer at least this often |
| `FLUSH_MAX_UNIQUE_QUERIES` [100] | batch-worker | ...or as soon as this many unique queries are buffered |
| `INDEX_REBUILD_INTERVAL_SECONDS` [unset = build once] | index-builder | Rebuild cadence (300 in Docker Compose) |
| `INDEX_SOURCE_ROW_LIMIT` [100000] | index-builder | Top-N queries by all-time count to index (200000 in Docker Compose) |
| `INDEX_RECENT_WINDOW_HOURS` [24] | index-builder | Also index queries searched within this window... |
| `INDEX_RECENT_ROW_LIMIT` [50000] | index-builder | ...up to this many |
| `INDEX_MAX_PREFIX_LENGTH` [50] | index-builder | Longest prefix to precompute (20 in Docker Compose) |
| `INDEX_ENTRY_TTL_SECONDS` [unset] | index-builder | Optional safety-net TTL; must be ≥ 2× the rebuild interval |
| `HASH_RING_BUCKET_COUNT` [16] | suggestion-service | Logical buckets on the ring |
| `HASH_RING_VIRTUAL_NODES` [128] | suggestion-service | Virtual nodes per bucket |

---

## Performance

Measured with Apache JMeter through nginx, using a 90:10 read/write mix (simulated typing with growing prefixes, plus search submissions):

| Endpoint | Samples | Mean | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /suggest` | 1,800 | 4.6 ms | **8 ms** | **11 ms** | 0 |
| `POST /search` | 200 | 6.7 ms | 9 ms | 10 ms | 0 |
| **Total** | **2,000** | 4.8 ms | 8 ms | 11 ms | **0** |

**Write reduction:** in a controlled test, 5 identical searches produced **1 upsert** (5× fewer writes). The reduction depends on how often queries repeat within a flush window: the JMeter run used mostly distinct queries and saw only 1.08×, while real traffic with popular repeated queries benefits much more.

**Index size:** 200K source queries produce about 1.1M prefix entries (max prefix length 20).

> These numbers come from a single-machine Docker setup and are a baseline, not a production SLA.

---

## Reliability fixes

Testing the system end to end turned up four real bugs, all now fixed:

| Problem | Fix |
| --- | --- |
| Kafka auto-committed offsets on read, while counts were only in memory, so a crash before the flush **lost searches** | Auto-commit disabled; offsets are committed only after the Postgres write succeeds (at-least-once) |
| The index was built once at startup, so **new searches never became suggestions** | The Index Builder rebuilds every 5 minutes; a failed rebuild keeps the previous version serving |
| Entries expired after 24h but the version pointer didn't, so **all suggestions disappeared after a day** | No TTL; old versions are deleted explicitly after each successful swap |
| Only the top-N queries by all-time count were indexed, so **a new query could never enter the index** | The source query now UNIONs the top N with recently searched queries, backed by a partial index on `last_seen` |

Verified end to end: a brand-new query searched **once** (count = 1) appeared in `/suggest` after the next automatic rebuild.

---

## Future improvements

- **Decay `recent_count`** (or keep hourly buckets) so the recency signal fades properly instead of relying on `last_seen` alone
- **Multi-row upsert** (`unnest`) to make one database round trip per flush instead of one per query
- **Cache the index version in memory** so `/suggest` makes 1 Redis call instead of 2
- **Typo tolerance** (`iphnoe` → `iphone`) and personalized suggestions
- **Hot-key handling** (e.g. "iphone" on launch day) with read replicas

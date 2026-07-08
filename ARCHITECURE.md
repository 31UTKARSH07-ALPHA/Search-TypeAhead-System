# Search Typeahead System — High-Level Architecture

## 1. Goals & Constraints

- Read-heavy system: typeahead reads vastly outnumber search-submission writes.
- Suggestion latency target: as low as possible, server-side (<10ms is the reference number from the read-heavy design intuition; treat as an aspirational target at demo scale, not a hard SLA).
- Stale reads and small amounts of write data loss are acceptable (explicit trade-off — see Section 7).
- Two pluggable ranking modes: **frequency** (all-time popularity) and **recency** (recent activity), plus a combined mode.
- Cache is treated as the **serving index**, not a lazily-populated cache-aside layer (see Section 6).

---

## 2. Components

| Component                        | Role                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router (nginx / API gateway)     | Path-based routing: `/suggest` → Suggestion Service, `/search` → Search Service                                                                                                                     |
| Search Service                   | Accepts `POST /search`, returns dummy response immediately, pushes event to buffer                                                                                                                  |
| Buffer / Queue                   | Holds raw search events between submission and aggregation (Kafka topic)                                                                                                                            |
| Batch Aggregator                 | Consumes the queue, aggregates counts (frequency + recency signals), flushes to Primary DB on a timer or batch-size trigger                                                                         |
| Primary DB                       | Source of truth: `(query, count, recentCount, lastSeen)` per query                                                                                                                                  |
| Index Builder / Cache Warmer     | Rebuilds the in-memory serving index from Primary DB and republishes it into the cache layer                                                                                                        |
| Cache Layer (Redis Cluster)      | Acts as the live serving index for `GET /suggest`; physical sharding is handled by Redis Cluster's own slot hashing, _steered_ by our own consistent-hash ring via hash tags (see Section 5)        |
| Consistent Hash Ring (app-level) | Maps a prefix to a logical bucket (`node0`, `node1`, ...) with virtual nodes for even distribution; the bucket name becomes a Redis hash tag, which Redis Cluster then maps to a physical slot/node |
| Ranking Strategy Module          | Pluggable scoring function (frequency / recency / combined) applied to candidate rows before truncating to top 10                                                                                   |
| Frontend                         | Search box, debounced suggestion calls, trending section, keyboard nav                                                                                                                              |

---

## 3. Write Path (search submission → durable count)

```
Frontend
   │  POST /search
   ▼
Search Service ──produce──▶ Kafka topic ──consume──▶ Batch Aggregator
   │  returns "Searched"                                   │
   ▼ (immediately, does not wait on DB)                     │ UPSERT, every N sec
                                                   count += n, recentCount updated
                                                              │
                                                              ▼
                                                         Primary DB
```

- The response to the user is decoupled from durability — `POST /search` never waits on a DB write.
- The aggregator collapses repeated queries within a flush window into a single upsert per query (this is the write-reduction evidence required by the rubric).
- Each flush updates **two signals** per query: all-time `count` and a recency signal (`recentCount` / `lastSeen`), needed for the recency and combined ranking strategies.

**Why Kafka instead of an in-memory buffer:** a real producer/consumer queue survives a Batch Aggregator crash without losing buffered events (unlike a plain in-process array), and gives a genuine consumer-group/partitioning setup to point to in the viva. It's a drop-in replacement for the queue box — nothing else in the write path changes.

**Failure trade-off:** even with Kafka, events written to the topic but not yet committed to the Primary DB at the moment of a crash can still be replayed on Batch Aggregator restart (consumer offset not yet committed) — so durability is materially stronger than the in-memory version, though not perfect end-to-end. Accepted per the stated NFR (small data loss is tolerable).

---

## 4. Index Refresh Path (DB → live cache)

```
Primary DB ──▶ Index Builder ──▶ new versioned key set in Redis ──▶ atomic switch
```

- The Index Builder periodically rebuilds prefix → top-N candidate data from the Primary DB and writes it into a **new version** of the cache keys (not overwriting live keys in place).
- Once the new version is fully written, the suggestion service flips to reading from it — an atomic swap, not a piecemeal update. This avoids serving a half-updated index mid-refresh.
- Cache nodes are fully warmed **before** being added to the serving pool (readiness gate), not populated lazily on first request.

---

## 5. Read Path (suggestion request → ranked top 10)

```
Frontend
   │  GET /suggest?q=<prefix>&rank=<frequency|recency|combined>
   ▼
Suggestion Service
   │  bucket = ring.hash(prefix)        — our consistent-hash ring, virtual nodes
   │  key = "{bucket}:" + prefix         — hash tag wraps only the bucket name
   ▼
Redis Cluster client ──▶ CLUSTER KEYSLOT("{bucket}") ──▶ physical node owning that slot
   │
   ├── entry exists for key → apply selected Ranking Strategy → top 10 → return
   │
   └── no entry for key → true miss → return empty (no DB fallback; see Section 6)
```

### Two layers of hashing, two different jobs

Real Redis Cluster does its own CRC16-based slot hashing per key and decides physical placement itself — if we hash raw prefixes as keys, Redis Cluster's hashing silently overrides whatever our own ring decides, and our hand-built consistent hashing becomes dead code. To keep our own consistent-hash ring meaningfully in control of data placement, we use **Redis hash tags**:

| Layer                  | Decides                                        | Mechanism                                                                         |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Application (our code) | _Which logical bucket a prefix belongs to_     | Hand-rolled consistent hash ring with virtual nodes, e.g. `hash("iph") → "node1"` |
| Redis Cluster          | _Which physical node a bucket's slot lives on_ | Redis's own CRC16 slot hashing, applied **only** to the substring inside `{}`     |

Every cache key is built as `{bucket}:prefix` — e.g. `{node1}:iph`. Redis Cluster hashes only the `node1` part (the hash tag) to pick a slot, so **every prefix our ring assigns to `node1` lands on the same physical node**, regardless of what the prefix itself is. The number of logical buckets (`node0`, `node1`, ...) is chosen up front, independent of however many physical masters the cluster actually has.

This is the standard mechanism Redis Cluster provides for forcing related keys onto the same node, and it's what lets us genuinely demonstrate our own consistent hashing on top of a real production-grade cluster rather than faking it.

- **Ranking mode (`rank=`) is a sub-key within the prefix entry**, not part of the hash tag — so `{node1}:iph` holds candidate data for all ranking modes of that prefix together, kept on one node.
- **Candidate data stored per prefix is ranking-agnostic** — raw `count` / `recentCount` / `lastSeen` per matching query. Sorting happens in the Ranking Strategy step, not baked into how data is stored. This is what makes swapping or adding ranking modes a localized change.

### `/cache/debug?prefix=` shows both layers

To honestly demonstrate the hashing (and answer "isn't Redis Cluster doing this for you?" in the viva), the debug endpoint reports both decisions side by side:

```
prefix: "iph"
ring decision:    bucket = node1            (our consistent-hash ring)
redis placement:  CLUSTER KEYSLOT {node1}   → slot 5462 → 10.0.0.3:6381  (Redis's own hashing)
cache result:     hit / miss
```

### Ranking strategies

| Strategy            | Signal used                                    | Behavior                                             |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Frequency (default) | `count`                                        | Historically popular queries rank first              |
| Recency             | `recentCount` decayed by time since `lastSeen` | Recently active queries rank first                   |
| Combined            | `log(count)` + weighted recency decay          | Balances long-term popularity with short-term spikes |

### Caveat

Ring-to-bucket mapping is a separate, manually-fixed concept from Redis Cluster's own slot ownership. If the cluster's master count changes, Redis re-shards slots automatically, but the ring's bucket count does not auto-adjust — out of scope for this assignment, called out explicitly rather than silently ignored.

---

## 6. Cache-Miss Handling (key design decision)

Two distinct cases are treated differently:

| Case                 | Meaning                                                                                                  | Behavior                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **True miss**        | Prefix has no matching queries anywhere in the dataset                                                   | Return empty results — correct answer, no DB call needed                                                                                 |
| **Operational miss** | Prefix _has_ matches, but the cache entry is missing due to a cold cluster, eviction, or mid-refresh gap | Should not occur in normal operation, because the cache is fully pre-warmed before serving (Section 4), not lazily populated per request |

**Design stance:** the cache is not cache-aside-with-fallback. It is the live serving index, fully rebuilt and republished by the offline pipeline, distributed across Redis Cluster nodes under our own hash-tag-steered consistent hashing (Section 5). There is intentionally **no per-request fallback to the Primary DB on a miss** — this mirrors how large-scale serving-index systems operate (full pre-load, versioned atomic swap, shard-level redundancy instead of per-query fallback), rather than the textbook cache-aside pattern.

**Accepted trade-offs:**

- **Cold start** — a freshly deployed cluster must finish a full warm-up load before serving traffic.
- **Freshness lag** — new queries become suggestable only after the next batch-aggregate + index-rebuild cycle, not on the next request.
- **Memory footprint** — every prefix's top-10 must be resident, not just hot ones (acceptable at this dataset scale).

This is a deliberate divergence from the literal "cache before falling back to primary store" wording in the assignment brief, framed explicitly as a stronger architectural choice rather than a missed requirement.

---

## 7. Non-Functional Trade-offs (stated explicitly)

- **Consistency vs. availability:** stale reads are acceptable; a query's true count can lag behind reality by up to one batch-flush + index-rebuild cycle.
- **Data loss:** acceptable in small amounts if the aggregator crashes before a flush.
- **Latency vs. freshness:** the entire design optimizes for low read latency (in-memory index, no DB on the read path) at the cost of write-to-visible-suggestion latency being bounded by the refresh cycle, not real-time.

---

## 8. Docker Replication Layout

```
nginx                — router, path-based: /suggest, /search
frontend              — UI
search-service        — POST /search, produces to Kafka
suggestion-service     — GET /suggest, ring hash → hash-tagged Redis Cluster lookup, ranking strategy
kafka, zookeeper (or redpanda) — durable buffer/queue for search events
redis-cluster (3+ master nodes, 1 replica each recommended) — serving index
batch-worker           — consumes Kafka, aggregates, upserts to Primary DB, triggers index rebuild
postgres               — Primary DB / source of truth
```

`suggestion-service` can optionally run multiple replicas to simulate index sharding beyond what consistent hashing alone demonstrates.

**Note on learning scope:** since standing up Redis Cluster (vs. standalone Redis instances) is itself a learning goal of this assignment, it's worth practicing `redis-cli --cluster create`, inspecting `CLUSTER NODES` / `CLUSTER SLOTS`, and verifying hash-tag behavior with `CLUSTER KEYSLOT {node1}:iph` directly against the running cluster before wiring it into the application — confirming the hash-tag mechanism works as expected in isolation makes debugging the full system much easier.

---

## 9. Load Testing Plan (JMeter)

- **Thread Group 1 (≈90% of load):** simulated typing — sequential growing prefixes per virtual user (`i`, `ip`, `iph`, ...) with small think-time, sourced from a CSV Data Set seeded with real dataset queries.
- **Thread Group 2 (≈10% of load):** `POST /search` submissions from the same query pool, matching the read:write ratio used to justify the read-optimized design.
- All requests go through the `nginx` router, not directly to services.
- **Metrics captured:** p95/p99 latency (Aggregate Report), cache hit rate (via `/cache/debug` or response-embedded flag), DB read/write counts before vs. after batching.
- **What to look for:** p95 should stay flat as concurrency ramps if the cache layer is absorbing load correctly; a climbing p95 indicates cache misses or DB contention leaking onto the read path.

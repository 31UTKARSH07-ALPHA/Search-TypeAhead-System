# Tech Stack

Companion to `architecture.md` — this file lists the concrete technology choices and why each was picked, for the README and for viva justification.

---

## 1. Stack at a glance

| Layer                 | Technology                                                 | Container                                    |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Router                | nginx                                                      | `nginx`                                      |
| Frontend              | Next.js + TypeScript + Tailwind                            | `frontend`                                   |
| Search Service        | Node.js + Express + TypeScript                             | `search-service`                             |
| Suggestion Service    | Node.js + Express + TypeScript                             | `suggestion-service`                         |
| Queue                 | Kafka (or Redpanda)                                        | `kafka` + `zookeeper` (or single `redpanda`) |
| Batch Aggregator      | Node.js worker, TypeScript, shared types with the services | `batch-worker`                               |
| Primary DB            | PostgreSQL                                                 | `postgres`                                   |
| Cache / serving index | Redis Cluster (3+ masters, 1 replica each recommended)     | `redis-cluster` (multiple node containers)   |
| Consistent hashing    | Hand-rolled ring with virtual nodes, app-level TypeScript  | inside `suggestion-service`                  |
| Containerization      | Docker + docker-compose                                    | —                                            |
| Load testing          | Apache JMeter                                              | run from host, targets `nginx`               |
| Dataset ingestion     | Node script + `csv-parse`, loads into Postgres on startup  | one-off job or part of `postgres` init       |

---

## 2. Why each piece, and what was deliberately avoided

### Node.js + Express + TypeScript (Search & Suggestion services)

Used across both services and the batch worker so types for the candidate row shape — `{query, count, recentCount, lastSeen}` — can be shared via one package instead of duplicated or re-validated across language boundaries. No framework heavier than Express is needed; both services are thin.

### Kafka (queue between Search Service and Batch Aggregator)

Chosen over a plain in-memory buffer specifically because **standing up a real producer/consumer system was a stated learning goal**, not just a requirement-satisfying choice. Gives genuine experience with topics, consumer groups, and offset commits, and survives a Batch Aggregator crash without losing buffered events the way an in-process array would. Redpanda is a drop-in lighter-weight alternative if Zookeeper/Kafka's resource footprint is a problem on a single dev machine — same wire protocol, same learning value, less to run.

**Avoided at first, added once needed:** originally scoped as "in-memory buffer is enough for assignment scale." Upgraded to Kafka once the goal shifted to also learning the real infra, not just satisfying the rubric.

### PostgreSQL (Primary DB)

Source of truth for `(query, count, recentCount, lastSeen)`. Picked over SQLite specifically because the assignment runs in Docker with multiple services — Postgres demonstrates a primary store cleanly separated from the cache layer, with real `UPSERT` (`ON CONFLICT DO UPDATE`) semantics and indexing to show in `EXPLAIN ANALYZE` for the viva. Prefix matching via `WHERE query LIKE 'prefix%'` with a B-tree index on `query` is sufficient at this dataset scale.

**Avoided:** a hand-built trie as the only prefix-matching structure. More "correct" at Google scale, but extra implementation surface for the same demo-scale result. Mentioned in the writeup as a known alternative, not built.

**Optional addition:** Elasticsearch, using its native `completion` suggester, as a second source the Index Builder can rebuild from instead of (or alongside) Postgres — genuinely how some production typeahead systems are built, and a good "we evaluated X vs Y" viva point if time allows.

### Redis Cluster (cache / serving index)

Required by the professor verbally, and is also the more production-representative choice (a real cluster-mode deployment with its own slot-based sharding underneath). Layered with an **application-level consistent-hash ring using Redis hash tags** (`{bucket}:prefix`) so the ring's bucket decision — not Redis's own CRC16 hashing of the raw key — controls which physical node owns which prefix. See `architecture.md` Section 5 for the full mechanism and the `/cache/debug` endpoint that demonstrates both layers side by side.

**Avoided:** relying on Redis Cluster's built-in hashing alone (would silently override the hand-rolled ring the rubric requires you to demonstrate). Also avoided: 3 standalone (non-cluster) Redis instances — was the original fallback plan before the professor's verbal requirement, kept as a fallback if cluster setup time runs out, but the cluster + hash-tag approach is the target design.

**Separate learning sandbox:** a second, ungraded `docker-compose.cluster-sandbox.yml` can be used to practice `redis-cli --cluster create`, `CLUSTER NODES`, `CLUSTER SLOTS`, and `CLUSTER KEYSLOT` in isolation before wiring the cluster into the application — recommended so cluster-setup debugging doesn't block application debugging.

### Hand-rolled consistent hashing

Built directly in the Suggestion Service rather than pulled from an npm package (e.g. `hashring`), because the assignment explicitly requires the student to demonstrate and explain this mechanism in the viva. Virtual nodes used to keep bucket distribution even across a small number of logical buckets.

### Next.js + TypeScript + Tailwind (frontend)

Matches prior project conventions (VoxField AI / Field-Service-AI), keeps tooling familiar so effort stays on the system-design parts of the assignment. Handles the debounced search input, suggestion dropdown, trending section, and keyboard navigation requirements directly.

### Docker + docker-compose

Already the stated plan. Each architectural component in `architecture.md` maps to exactly one compose service, which keeps the README's "architecture diagram" and the actual running system easy to cross-reference during the viva.

### Apache JMeter

Already the stated plan. Thread groups modeled on the 90:10 read:write ratio referenced in the lecture notes (see `architecture.md` Section 9 for the full test plan), targeting `nginx` rather than services directly so the router is exercised too.

---

## 3. Explicitly not used, and why

| Tool                                    | Why it was ruled out for this assignment                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elasticsearch as the _only_ store       | Adds a second source-of-truth-shaped system; fine as an optional addition on top of Postgres, not a replacement for it at this scope                          |
| A full trie data structure              | Correct at Google scale, unnecessary implementation cost at 100K-row demo scale; SQL `LIKE` + index is sufficient and easier to explain                       |
| Redis Cluster's hashing used unmediated | Would defeat the requirement to demonstrate the student's own consistent hashing                                                                              |
| SQS / RabbitMQ instead of Kafka         | Kafka chosen specifically for its consumer-group/partition learning value over assignment scope alone; either would technically satisfy the queue requirement |

# Implementation Plan

This file is the working plan for building the search typeahead system described in `architecture.md` and `STACK.md`. It is broken into phases, each phase into sub-phases. Follow the workflow rules below exactly — they control branching, commits, and how progress is tracked so the work can be paused and resumed cleanly.

`IMPLEMENTATION.md` and `CHANGES.md` are working documents only. They are listed in `.gitignore` and must never be committed, referenced in a commit message, or referenced in a PR description.

---

## Workflow rules

### Branching

- One branch per phase, named `phase-N-short-name` (e.g. `phase-3-suggestion-api`), cut from `main` at the start of the phase.
- Do not start a phase's branch until the previous phase's PR has been merged to `main`.
- All sub-phases within a phase happen as commits on that same branch.

### Commits

- One commit per completed sub-phase. Do not bundle multiple sub-phases into one commit, and do not split a single sub-phase across multiple commits unless it genuinely fails to build/run partway (in which case fix-up commits are fine).
- Commit messages are short, imperative, present tense, and describe only what changed — standard conventional style is fine (`feat: add prefix query for suggestion candidates`, `fix: correct upsert conflict target`, `chore: add postgres healthcheck`). Write them the way a developer would write their own commit while working through a task: plain, specific, no filler.
- Do not reference tooling, automation, or how the change was produced anywhere in a commit message or PR description. Describe the change itself, nothing about the process that created it.
- Run the relevant tests/build before committing a sub-phase. A commit should leave the branch in a working state.

### CHANGES.md (resume log)

- After every completed sub-phase, append one entry to `CHANGES.md` at the repo root, in this format:

```
## Phase N.M — <sub-phase title>
Status: done
Commit: <short hash> <commit message first line>
Notes: <anything the next session needs to know — decisions made, things deferred, gotchas>
```

- If a sub-phase is started but not finished in a session, add an entry with `Status: in progress` and enough detail in `Notes` to pick it back up without re-reading the whole codebase.
- At the start of any new session, read `CHANGES.md` first. Resume from the first sub-phase that is not marked `done`. Do not re-do completed sub-phases.
- `CHANGES.md` is local bookkeeping only — never part of any commit, never mentioned in a PR.

### Pull requests

- Open the PR once all sub-phases in a phase are committed and the branch is in a fully working state.
- PR title: short phase summary (e.g. "Suggestion API with frequency ranking"). PR description: what the phase adds, how to test it locally, anything the reviewer should specifically check. No process commentary, no tooling mentions.
- Merge only after the phase's stated exit criteria (listed under each phase below) are actually verified, not just assumed.

---

## Phase 1 — Foundations

Branch: `phase-1-foundations`

**1.1 — Monorepo structure**
Set up the top-level folders: `frontend/`, `services/search-service/`, `services/suggestion-service/`, `services/batch-worker/`, `packages/shared-types/`, `db/`, `infra/`. Each service gets its own `package.json`, `tsconfig.json`, minimal Express boilerplate with a health-check route.

**1.2 — Shared types package**
Create `packages/shared-types` with the core candidate row shape (`query`, `count`, `recentCount`, `lastSeen`) and any other types reused across services. Wire it as a local dependency in each service.

**1.3 — Docker Compose skeleton**
Base `docker-compose.yml` with `nginx`, `frontend`, `search-service`, `suggestion-service`, `postgres` only — no Kafka or Redis yet. Goal: everything builds and starts, health checks pass, nginx routes `/health` to each service correctly.

**1.4 — nginx routing config**
Path-based routing: `/suggest*` → suggestion-service, `/search*` → search-service. Verify with curl through nginx, not direct service calls.

**Exit criteria:** `docker-compose up` brings up all five containers cleanly; hitting `/health` through nginx returns 200 from the right service.

---

## Phase 2 — Dataset & primary database

Branch: `phase-2-dataset-db`

**2.1 — Schema and migrations**
Postgres table for queries: `query TEXT PRIMARY KEY, count BIGINT, recent_count BIGINT, last_seen TIMESTAMPTZ`. B-tree index on `query` for prefix matching. Use a plain SQL migration file checked into `db/migrations/`.

**2.2 — Dataset selection and loader**
Pick a public dataset with ≥100,000 query/count rows (or derive counts by aggregation if the source dataset lacks them). Write a Node/TS loader script that reads the CSV and bulk-inserts into Postgres. Document the dataset source and exact loading command in the README.

**2.3 — Verify indexing**
Run `EXPLAIN ANALYZE` on a representative `WHERE query LIKE 'prefix%' ORDER BY count DESC LIMIT 10` and confirm the index is actually used. Note the result in `CHANGES.md` for later reference in the performance report.

**Exit criteria:** dataset loaded, row count ≥100,000 confirmed, indexed prefix query returns correct results in milliseconds locally.

---

## Phase 3 — Suggestion API (database-only, no cache yet)

Branch: `phase-3-suggestion-api`

**3.1 — Candidate fetch query**
Function in suggestion-service that takes a prefix and returns raw candidate rows from Postgres — no ranking applied yet, just matching rows.

**3.2 — Ranking strategy module (frequency only for now)**
Scaffold the pluggable ranking interface described in `architecture.md` Section 5, with a single `FrequencyStrategy` implemented. Structure it so `RecencyStrategy` and `CombinedStrategy` can be added later without touching the fetch layer.

**3.3 — `GET /suggest` endpoint**
Wire fetch → rank → top 10 → JSON response. Handle empty input, missing input, mixed-case input, and no-match prefixes gracefully (empty array, not an error). Enforce the 3-letter minimum and 50-letter maximum from the MVP rules.

**Exit criteria:** `GET /suggest?q=iph` returns up to 10 results sorted by count descending, edge cases handled without 500s.

---

## Phase 4 — Frontend: search and suggestions UI

Branch: `phase-4-frontend-search-ui`

**4.1 — Search input with debounce**
Search box component, debounced calls to `/suggest` as the user types, only firing after 3+ characters.

**4.2 — Suggestion dropdown with keyboard navigation**
Dropdown rendering results, arrow-key navigation, enter-to-select.

**4.3 — Loading and error states**
Visible loading indicator while a request is in flight, visible error state on request failure, clean empty state for no matches.

**Exit criteria:** typing in the search box visibly produces live suggestions end to end through the running stack.

---

## Phase 5 — Search submission (synchronous, pre-batching)

Branch: `phase-5-search-submission`

**5.1 — Dummy search endpoint**
`POST /search` in search-service returns `{ "message": "Searched" }`.

**5.2 — Synchronous count update**
For now, directly upsert the submitted query into Postgres (`count = count + 1`, insert if new) on every request — this is intentionally the simple version, replaced by batching in Phase 7. Gets the full loop working before adding queue complexity.

**5.3 — Frontend search submission**
Wire the search button / Enter key to call `POST /search` and display the dummy response.

**Exit criteria:** submitting a search updates the count in Postgres and is reflected next time that prefix is queried.

---

## Phase 6 — Kafka queue integration

Branch: `phase-6-kafka-queue`

**6.1 — Kafka (or Redpanda) in Docker Compose**
Add broker (+ Zookeeper if using Kafka, not needed for Redpanda) to the compose file. Create the search-events topic.

**6.2 — Producer in search-service**
Replace the Phase 5 synchronous upsert with a Kafka producer call. `POST /search` now only produces an event and returns immediately — no DB write on this path anymore.

**6.3 — Consumer skeleton in batch-worker**
New `batch-worker` service consumes the topic and logs each event. No aggregation logic yet — that's Phase 7. Goal here is just a verified, working consumer.

**Exit criteria:** submitting a search produces a Kafka message; batch-worker logs show it being consumed. Postgres is not yet updated by this path (expected — Phase 7 reconnects it).

---

## Phase 7 — Batch aggregation

Branch: `phase-7-batch-aggregation`

**7.1 — In-memory aggregation buffer**
batch-worker accumulates consumed events into a `Map<query, count>` instead of writing immediately.

**7.2 — Flush triggers**
Flush on a timer (e.g. every 2s) or when the buffer hits a configurable size threshold, whichever comes first. On flush, issue one upsert per unique query in that batch.

**7.3 — Write-reduction logging**
Log raw events consumed vs. upserts issued per flush cycle, so the ratio can be reported later in the performance write-up.

**Exit criteria:** repeated searches for the same query within a flush window result in a single Postgres write, not one per search. Ratio is visible in logs.

---

## Phase 8 — Redis Cluster setup

Branch: `phase-8-redis-cluster`

**8.1 — Cluster sandbox (manual verification, kept separate from main stack)**
Separate `docker-compose.cluster-sandbox.yml` with enough Redis nodes to form a cluster. Run `redis-cli --cluster create` manually, verify with `CLUSTER NODES` / `CLUSTER SLOTS`, and confirm hash-tag behavior with `CLUSTER KEYSLOT {node1}:test` before touching application code.

**8.2 — Cluster in main compose**
Add the verified cluster setup to the main `docker-compose.yml`.

**8.3 — Cluster client in suggestion-service**
Wire a Redis Cluster client into suggestion-service. No ring logic yet — just confirm the service can read/write through the cluster.

**Exit criteria:** cluster is healthy, `CLUSTER NODES` shows the expected topology, suggestion-service can set/get a test key through it.

---

## Phase 9 — Consistent hashing and cache read path

Branch: `phase-9-consistent-hashing`

**9.1 — Hash ring implementation**
Hand-rolled consistent-hash ring with virtual nodes, mapping a prefix to a logical bucket name (`node0`, `node1`, ...).

**9.2 — Hash-tag key builder**
Helper that builds Redis keys as `{bucket}:prefix` so Redis Cluster's own slot hashing only sees the bucket name, not the prefix.

**9.3 — Cache-as-index read path**
`GET /suggest` now checks the cache first via the ring + hash-tag key. True miss (no entry at all) returns empty results directly — no DB fallback, per the design in `architecture.md` Section 6.

**9.4 — `/cache/debug?prefix=` endpoint**
Returns the ring's bucket decision and Redis Cluster's actual slot/node for that key, side by side, plus hit/miss status.

**Exit criteria:** `/cache/debug` correctly shows both hashing layers agreeing; cache reads work end to end (once populated — population is Phase 10).

---

## Phase 10 — Index builder and cache warmer

Branch: `phase-10-index-builder`

**10.1 — Index builder job**
Reads all distinct prefixes' top candidates from Postgres and computes the data each cache entry needs.

**10.2 — Versioned write and atomic switch**
Builder writes to a new versioned key set rather than overwriting live keys in place, then flips a pointer/version key once the write is complete.

**10.3 — Startup readiness gate**
suggestion-service does not accept traffic until the cache has been confirmed warm (initial build completed at least once).

**Exit criteria:** restarting the stack from empty results in a fully warm cache before suggestion-service starts serving; triggering a rebuild while serving does not cause a visible gap in results.

---

## Phase 11 — Ranking strategies (recency and combined)

Branch: `phase-11-ranking-strategies`

**11.1 — Recency signal maintenance**
Extend the Phase 7 batch aggregator to also update `recent_count` and `last_seen` per query on each flush.

**11.2 — Recency and combined strategies**
Implement `RecencyStrategy` and `CombinedStrategy` per the scoring approach in `architecture.md` Section 5, alongside the existing `FrequencyStrategy`.

**11.3 — `rank=` query param**
Wire `GET /suggest?q=...&rank=frequency|recency|combined` through to the strategy selection. Update the index builder/cache so all three ranking views are available per prefix without re-fetching from Postgres.

**Exit criteria:** same prefix, different `rank=` values, visibly different ordering — captured as a side-by-side example for the report.

---

## Phase 12 — Trending searches

Branch: `phase-12-trending`

**12.1 — Trending endpoint**
Endpoint returning top queries by recency-weighted score, reusing the ranking infrastructure from Phase 11.

**12.2 — Frontend trending section**
Display trending queries in the UI, separate from the prefix-suggestion dropdown.

**Exit criteria:** trending section visibly differs from straight frequency ranking and updates after new searches propagate through a batch/index cycle.

---

## Phase 13 — Performance measurement

Branch: `phase-13-performance`

**13.1 — JMeter test plan**
Build the thread groups described in `architecture.md` Section 9 — typeahead traffic at ~90%, search submissions at ~10%, both through nginx, using the dataset as the CSV source for realistic queries.

**13.2 — Baseline run**
Run against the full stack, capture p95/p99 latency, cache hit rate, and DB write counts before/after batching.

**13.3 — Document results**
Write findings into the performance report section of the README — actual numbers, not estimates.

**Exit criteria:** a JMeter results export and a written summary exist and match what's claimed in the README.

---

## Phase 14 — Documentation and polish

Branch: `phase-14-docs-polish`

**14.1 — README**
Setup instructions, dataset source, how to run locally, how to run the cluster sandbox separately.

**14.2 — API documentation**
All endpoints listed with example requests/responses, including `/cache/debug`.

**14.3 — Screenshots and demo**
Capture the UI in action — search, suggestions, trending, both ranking modes.

**14.4 — Final review**
Walk through every exit criterion from Phases 1–13 and confirm each still holds on a clean `docker-compose up` from a fresh clone.

**Exit criteria:** a reviewer with no prior context can clone the repo, follow the README, and see the full system working.

---

## Resuming work

1. Read `CHANGES.md`.
2. Find the first entry not marked `done`.
3. Check out (or create, if not yet created) that phase's branch.
4. Continue from that sub-phase.

import { PrefixIndexBuilder } from "./prefixIndexBuilder.js";
import { PostgresQuerySourceRepository } from "./postgresQuerySourceRepository.js";
import { readIndexBuilderConfig, type IndexBuilderConfig } from "./indexBuilderConfig.js";
import { ConsistentHashRing } from "../cache/consistentHashRing.js";
import { RedisClusterClient } from "../cache/redisClusterClient.js";
import { SuggestionCacheKeyBuilder } from "../cache/suggestionCacheKeyBuilder.js";
import { CombinedStrategy } from "../ranking/combinedStrategy.js";
import { FrequencyStrategy } from "../ranking/frequencyStrategy.js";
import { RecencyStrategy } from "../ranking/recencyStrategy.js";
import type { SuggestionCacheIndexWrite } from "../cache/redisClusterClient.js";

// Requests that read the old version pointer just before the switch still finish against old keys.
const staleVersionGraceMs = 5000;

let stopRequested = false;
let wakeUp: (() => void) | null = null;

async function main() {
  const config = readIndexBuilderConfig();
  const querySourceRepository = new PostgresQuerySourceRepository(config.databaseUrl);
  const redisClusterClient = new RedisClusterClient(config.redisClusterNodes);
  const hashRing = new ConsistentHashRing({
    bucketCount: config.hashRingBucketCount,
    virtualNodeCount: config.hashRingVirtualNodes
  });
  const cacheKeyBuilder = new SuggestionCacheKeyBuilder(hashRing);

  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  try {
    await redisClusterClient.connect();

    // A failed first build exits non-zero: there is no index to serve yet.
    await buildAndPublishIndex(config, querySourceRepository, redisClusterClient, cacheKeyBuilder);

    if (!config.rebuildIntervalSeconds) {
      return;
    }

    // Rebuild so new searches (written to Postgres by batch-worker) reach /suggest.
    // A failed rebuild is logged and the previous version keeps serving.
    while (!stopRequested) {
      await sleep(config.rebuildIntervalSeconds * 1000);
      if (stopRequested) {
        break;
      }

      try {
        await buildAndPublishIndex(config, querySourceRepository, redisClusterClient, cacheKeyBuilder);
      } catch (error) {
        console.error("Suggestion index rebuild failed; previous version still serving", error);
      }
    }
  } finally {
    await Promise.all([querySourceRepository.close(), redisClusterClient.close()]);
  }
}

async function buildAndPublishIndex(
  config: IndexBuilderConfig,
  querySourceRepository: PostgresQuerySourceRepository,
  redisClusterClient: RedisClusterClient,
  cacheKeyBuilder: SuggestionCacheKeyBuilder
): Promise<void> {
  const indexVersion = createIndexVersion();
  const candidates = await querySourceRepository.findTopQueries(config.sourceRowLimit);
  const prefixEntriesByPrefix = new PrefixIndexBuilder({
    minPrefixLength: config.minPrefixLength,
    maxPrefixLength: config.maxPrefixLength,
    candidatesPerPrefix: config.candidatesPerPrefix
  }, [
    new FrequencyStrategy(),
    new RecencyStrategy(),
    new CombinedStrategy()
  ]).build(candidates);

  console.log(
    JSON.stringify({
      message: "Computed suggestion index entries",
      sourceQueryCount: candidates.length,
      prefixEntryCount: prefixEntriesByPrefix.size,
      candidatesPerPrefix: config.candidatesPerPrefix,
      rankingModes: ["frequency", "recency", "combined"]
    })
  );

  let writtenEntryCount = 0;
  let pendingWrites: SuggestionCacheIndexWrite[] = [];

  for (const [prefix, candidatesForPrefix] of prefixEntriesByPrefix.entries()) {
    pendingWrites.push({
      key: cacheKeyBuilder.build(prefix, indexVersion).key,
      entry: {
        candidates: candidatesForPrefix
      }
    });
    prefixEntriesByPrefix.delete(prefix);

    if (pendingWrites.length >= config.writeBatchSize) {
      writtenEntryCount += await redisClusterClient.writeSuggestionIndexEntries(
        pendingWrites,
        config.writeBatchSize,
        config.indexEntryTtlSeconds
      );
      pendingWrites = [];
    }
  }

  if (pendingWrites.length > 0) {
    writtenEntryCount += await redisClusterClient.writeSuggestionIndexEntries(
      pendingWrites,
      config.writeBatchSize,
      config.indexEntryTtlSeconds
    );
  }

  await redisClusterClient.setCurrentIndexVersion(indexVersion);

  console.log(
    JSON.stringify({
      message: "Published suggestion index",
      indexVersion,
      writtenEntryCount,
      indexEntryTtlSeconds: config.indexEntryTtlSeconds ?? null
    })
  );

  await sleep(staleVersionGraceMs);
  const deletedKeyCount = await redisClusterClient.deleteIndexVersionsExcept(indexVersion);

  console.log(
    JSON.stringify({
      message: "Deleted stale suggestion index versions",
      keptIndexVersion: indexVersion,
      deletedKeyCount
    })
  );
}

function createIndexVersion(): string {
  return `v${new Date().toISOString().replace(/[-:.]/g, "")}`;
}

function requestStop(): void {
  stopRequested = true;
  wakeUp?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, ms);
    wakeUp = () => {
      clearTimeout(timeoutId);
      resolve();
    };
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

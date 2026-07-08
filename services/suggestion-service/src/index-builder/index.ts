import { PrefixIndexBuilder } from "./prefixIndexBuilder.js";
import { PostgresQuerySourceRepository } from "./postgresQuerySourceRepository.js";
import { readIndexBuilderConfig } from "./indexBuilderConfig.js";
import { ConsistentHashRing } from "../cache/consistentHashRing.js";
import { RedisClusterClient } from "../cache/redisClusterClient.js";
import { SuggestionCacheKeyBuilder } from "../cache/suggestionCacheKeyBuilder.js";
import { CombinedStrategy } from "../ranking/combinedStrategy.js";
import { FrequencyStrategy } from "../ranking/frequencyStrategy.js";
import { RecencyStrategy } from "../ranking/recencyStrategy.js";
import type { SuggestionCacheIndexWrite } from "../cache/redisClusterClient.js";

async function main() {
  const config = readIndexBuilderConfig();
  const querySourceRepository = new PostgresQuerySourceRepository(config.databaseUrl);
  const redisClusterClient = new RedisClusterClient(config.redisClusterNodes);
  const hashRing = new ConsistentHashRing({
    bucketCount: config.hashRingBucketCount,
    virtualNodeCount: config.hashRingVirtualNodes
  });
  const cacheKeyBuilder = new SuggestionCacheKeyBuilder(hashRing);
  const indexVersion = createIndexVersion();

  try {
    await redisClusterClient.connect();

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
        indexEntryTtlSeconds: config.indexEntryTtlSeconds
      })
    );
  } finally {
    await Promise.all([querySourceRepository.close(), redisClusterClient.close()]);
  }
}

function createIndexVersion(): string {
  return `v${new Date().toISOString().replace(/[-:.]/g, "")}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

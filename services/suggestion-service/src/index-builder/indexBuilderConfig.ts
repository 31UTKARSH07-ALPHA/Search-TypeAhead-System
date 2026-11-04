import { readConfig, type RedisClusterNodeConfig } from "../config.js";

export interface IndexBuilderConfig {
  databaseUrl: string;
  redisClusterNodes: RedisClusterNodeConfig[];
  hashRingBucketCount: number;
  hashRingVirtualNodes: number;
  minPrefixLength: number;
  maxPrefixLength: number;
  candidatesPerPrefix: number;
  sourceRowLimit: number;
  writeBatchSize: number;
  // Optional safety net; old versions are normally removed explicitly after each publish.
  indexEntryTtlSeconds: number | undefined;
  // Unset = build once and exit.
  rebuildIntervalSeconds: number | undefined;
}

export function readIndexBuilderConfig(): IndexBuilderConfig {
  const serviceConfig = readConfig();
  const indexEntryTtlSeconds = readOptionalPositiveInteger("INDEX_ENTRY_TTL_SECONDS");
  const rebuildIntervalSeconds = readOptionalPositiveInteger("INDEX_REBUILD_INTERVAL_SECONDS");

  // Entries must outlive at least two rebuild cycles, otherwise one slow or failed rebuild
  // leaves the current-version pointer aimed at expired keys and /suggest returns nothing.
  if (indexEntryTtlSeconds !== undefined) {
    const minimumTtl = (rebuildIntervalSeconds ?? Number.POSITIVE_INFINITY) * 2;
    if (indexEntryTtlSeconds < minimumTtl) {
      throw new Error(
        "INDEX_ENTRY_TTL_SECONDS must be at least 2x INDEX_REBUILD_INTERVAL_SECONDS (or unset for a one-off build)"
      );
    }
  }

  return {
    databaseUrl: serviceConfig.databaseUrl,
    redisClusterNodes: serviceConfig.redisClusterNodes,
    hashRingBucketCount: serviceConfig.hashRingBucketCount,
    hashRingVirtualNodes: serviceConfig.hashRingVirtualNodes,
    minPrefixLength: readPositiveInteger("INDEX_MIN_PREFIX_LENGTH", 3),
    maxPrefixLength: readPositiveInteger("INDEX_MAX_PREFIX_LENGTH", 50),
    candidatesPerPrefix: readPositiveInteger("INDEX_CANDIDATES_PER_PREFIX", 10),
    sourceRowLimit: readPositiveInteger("INDEX_SOURCE_ROW_LIMIT", 100000),
    writeBatchSize: readPositiveInteger("INDEX_WRITE_BATCH_SIZE", 500),
    indexEntryTtlSeconds,
    rebuildIntervalSeconds
  };
}

function readOptionalPositiveInteger(name: string): number | undefined {
  return process.env[name] ? readPositiveInteger(name, 0) : undefined;
}

function readPositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

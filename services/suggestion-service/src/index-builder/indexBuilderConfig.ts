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
  indexEntryTtlSeconds: number;
}

export function readIndexBuilderConfig(): IndexBuilderConfig {
  const serviceConfig = readConfig();

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
    indexEntryTtlSeconds: readPositiveInteger("INDEX_ENTRY_TTL_SECONDS", 86400)
  };
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

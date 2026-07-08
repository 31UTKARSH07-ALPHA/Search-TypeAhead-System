export interface RedisClusterNodeConfig {
  host: string;
  port: number;
}

export interface SuggestionServiceConfig {
  port: number;
  databaseUrl: string;
  redisClusterNodes: RedisClusterNodeConfig[];
  hashRingBucketCount: number;
  hashRingVirtualNodes: number;
  cacheReadyTimeoutMs: number;
  cacheReadyPollMs: number;
}

export function readConfig(): SuggestionServiceConfig {
  return {
    port: Number(process.env.PORT ?? 4002),
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://typeahead:typeahead@postgres:5432/typeahead",
    redisClusterNodes: readRedisClusterNodes(
      process.env.REDIS_CLUSTER_NODES ??
        "redis-node-0:6379,redis-node-1:6379,redis-node-2:6379"
    ),
    hashRingBucketCount: readPositiveInteger("HASH_RING_BUCKET_COUNT", 16),
    hashRingVirtualNodes: readPositiveInteger("HASH_RING_VIRTUAL_NODES", 128),
    cacheReadyTimeoutMs: readPositiveInteger("CACHE_READY_TIMEOUT_MS", 60000),
    cacheReadyPollMs: readPositiveInteger("CACHE_READY_POLL_MS", 1000)
  };
}

function readRedisClusterNodes(value: string): RedisClusterNodeConfig[] {
  const nodes = value
    .split(",")
    .map((node) => node.trim())
    .filter(Boolean)
    .map((node) => {
      const [host, portValue] = node.split(":");
      const port = Number(portValue ?? 6379);

      if (!host || !Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid Redis Cluster node: ${node}`);
      }

      return {
        host,
        port
      };
    });

  if (nodes.length === 0) {
    throw new Error("REDIS_CLUSTER_NODES must include at least one node");
  }

  return nodes;
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

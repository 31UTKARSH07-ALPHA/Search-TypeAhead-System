import Redis, { type Cluster } from "ioredis";
import type { RedisClusterNodeConfig } from "../config.js";
import type { SuggestionCacheEntry, SuggestionCacheRepository } from "./suggestionCacheRepository.js";

const currentIndexVersionKey = "typeahead:suggest:index:current-version";

export interface RedisSlotOwner {
  slot: number;
  node: string | null;
}

export interface SuggestionCacheIndexWrite {
  key: string;
  entry: SuggestionCacheEntry;
}

export interface CacheReadyWaitOptions {
  timeoutMs: number;
  pollMs: number;
}

export class RedisClusterClient implements SuggestionCacheRepository {
  private readonly cluster: Cluster;

  public constructor(nodes: RedisClusterNodeConfig[]) {
    this.cluster = new Redis.Cluster(nodes, {
      lazyConnect: true,
      redisOptions: {
        maxRetriesPerRequest: 3
      },
      slotsRefreshTimeout: 2000
    });
  }

  public async connect(): Promise<void> {
    await this.cluster.connect();
  }

  public async verifyReadWrite(): Promise<void> {
    const key = "typeahead:redis-cluster:startup-check";
    const value = new Date().toISOString();

    await this.cluster.set(key, value, "EX", 60);
    const storedValue = await this.cluster.get(key);

    if (storedValue !== value) {
      throw new Error("Redis Cluster startup read/write verification failed");
    }

    console.log(
      JSON.stringify({
        message: "Redis Cluster read/write verification passed",
        key
      })
    );
  }

  public async get(cacheKey: string): Promise<SuggestionCacheEntry | null> {
    const value = await this.cluster.get(cacheKey);
    if (!value) {
      return null;
    }

    return parseSuggestionCacheEntry(value);
  }

  public async getCurrentIndexVersion(): Promise<string | null> {
    return this.cluster.get(currentIndexVersionKey);
  }

  public async setCurrentIndexVersion(indexVersion: string): Promise<void> {
    await this.cluster.set(currentIndexVersionKey, indexVersion);
  }

  public async waitForCurrentIndexVersion(options: CacheReadyWaitOptions): Promise<string> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() <= deadline) {
      const indexVersion = await this.getCurrentIndexVersion();

      if (indexVersion) {
        return indexVersion;
      }

      await sleep(options.pollMs);
    }

    throw new Error(
      `Timed out waiting ${options.timeoutMs}ms for Redis suggestion index version`
    );
  }

  public async writeSuggestionIndexEntries(
    writes: SuggestionCacheIndexWrite[],
    batchSize: number,
    ttlSeconds?: number
  ): Promise<number> {
    let written = 0;
    const writesByHashTag = groupWritesByHashTag(writes);

    for (const hashTagWrites of writesByHashTag.values()) {
      for (let offset = 0; offset < hashTagWrites.length; offset += batchSize) {
        const batch = hashTagWrites.slice(offset, offset + batchSize);
        const pipeline = this.cluster.pipeline();

        for (const write of batch) {
          if (ttlSeconds) {
            pipeline.set(write.key, JSON.stringify(write.entry), "EX", ttlSeconds);
          } else {
            pipeline.set(write.key, JSON.stringify(write.entry));
          }
        }

        const results = await pipeline.exec();
        const failedResult = results?.find(([error]) => error);

        if (failedResult?.[0]) {
          throw failedResult[0];
        }

        written += batch.length;
      }
    }

    return written;
  }

  public async exists(cacheKey: string): Promise<boolean> {
    return (await this.cluster.exists(cacheKey)) === 1;
  }

  public async getSlotOwner(cacheKey: string): Promise<RedisSlotOwner> {
    const slot = Number(await this.cluster.call("CLUSTER", "KEYSLOT", cacheKey));
    const slots = (await this.cluster.call("CLUSTER", "SLOTS")) as RedisClusterSlotsResponse;

    return {
      slot,
      node: findNodeForSlot(slots, slot)
    };
  }

  public async close(): Promise<void> {
    await this.cluster.quit();
  }
}

type RedisClusterSlotsResponse = Array<
  [
    number,
    number,
    [string, number, string],
    ...Array<[string, number, string]>
  ]
>;

function parseSuggestionCacheEntry(value: string): SuggestionCacheEntry | null {
  let parsed: Partial<SuggestionCacheEntry>;

  try {
    parsed = JSON.parse(value) as Partial<SuggestionCacheEntry>;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.candidates)) {
    return null;
  }

  return {
    candidates: parsed.candidates.filter(isSuggestionCandidate)
  };
}

function groupWritesByHashTag(
  writes: SuggestionCacheIndexWrite[]
): Map<string, SuggestionCacheIndexWrite[]> {
  const writesByHashTag = new Map<string, SuggestionCacheIndexWrite[]>();

  for (const write of writes) {
    const hashTag = extractHashTag(write.key);
    const hashTagWrites = writesByHashTag.get(hashTag) ?? [];
    hashTagWrites.push(write);
    writesByHashTag.set(hashTag, hashTagWrites);
  }

  return writesByHashTag;
}

function extractHashTag(key: string): string {
  const match = key.match(/^\{([^}]+)\}/);

  if (!match) {
    return key;
  }

  return match[1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSuggestionCandidate(value: unknown): value is SuggestionCacheEntry["candidates"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.query === "string" &&
    typeof candidate.count === "number" &&
    typeof candidate.recentCount === "number" &&
    (typeof candidate.lastSeen === "string" || candidate.lastSeen === null)
  );
}

function findNodeForSlot(slots: RedisClusterSlotsResponse, slot: number): string | null {
  for (const [startSlot, endSlot, masterNode] of slots) {
    if (slot >= startSlot && slot <= endSlot) {
      return `${masterNode[0]}:${masterNode[1]}`;
    }
  }

  return null;
}

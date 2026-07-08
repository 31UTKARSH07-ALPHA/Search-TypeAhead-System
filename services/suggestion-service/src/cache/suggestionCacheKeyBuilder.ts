import type { ConsistentHashRing } from "./consistentHashRing.js";

export interface SuggestionCacheKey {
  prefix: string;
  bucket: string;
  indexVersion: string;
  key: string;
}

export class SuggestionCacheKeyBuilder {
  public constructor(private readonly hashRing: ConsistentHashRing) {}

  public build(prefix: string, indexVersion: string): SuggestionCacheKey {
    const bucket = this.hashRing.getBucket(prefix);

    return {
      prefix,
      bucket,
      indexVersion,
      key: `{${bucket}}:suggest:${indexVersion}:${prefix}`
    };
  }
}

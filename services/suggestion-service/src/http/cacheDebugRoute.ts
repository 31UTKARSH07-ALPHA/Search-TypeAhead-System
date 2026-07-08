import { Router, type Request, type Response } from "express";
import type { CacheDebugResponse } from "@typeahead/shared-types";
import type { RedisClusterClient } from "../cache/redisClusterClient.js";
import type { SuggestionCacheKeyBuilder } from "../cache/suggestionCacheKeyBuilder.js";
import { normalizePrefix } from "./prefix.js";

export function createCacheDebugRouter(
  redisClusterClient: RedisClusterClient,
  cacheKeyBuilder: SuggestionCacheKeyBuilder
) {
  const router = Router();

  router.get("/cache/debug", async (req: Request, res: Response, next) => {
    try {
      const { prefix } = normalizePrefix(req.query.prefix);
      const indexVersion = await redisClusterClient.getCurrentIndexVersion();
      const cacheKey = cacheKeyBuilder.build(prefix, indexVersion ?? "unavailable");
      const [hit, slotOwner] = await Promise.all([
        indexVersion ? redisClusterClient.exists(cacheKey.key) : Promise.resolve(false),
        redisClusterClient.getSlotOwner(cacheKey.key)
      ]);

      const response: CacheDebugResponse = {
        prefix,
        cacheKey: cacheKey.key,
        bucket: cacheKey.bucket,
        indexVersion,
        redisSlot: slotOwner.slot,
        redisNode: slotOwner.node,
        hit
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

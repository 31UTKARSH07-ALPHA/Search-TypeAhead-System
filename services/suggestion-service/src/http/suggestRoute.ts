import { Router, type Request, type Response } from "express";
import type { RankingMode, SuggestResponse } from "@typeahead/shared-types";
import type { SuggestionCacheKeyBuilder } from "../cache/suggestionCacheKeyBuilder.js";
import type { SuggestionCacheRepository } from "../cache/suggestionCacheRepository.js";
import type { RankingStrategyRegistry } from "../ranking/rankingStrategyRegistry.js";
import { normalizePrefix } from "./prefix.js";

const responseLimit = 10;

function readRankingMode(value: unknown): RankingMode {
  if (value === "frequency" || value === "recency" || value === "combined") {
    return value;
  }

  return "frequency";
}

export function createSuggestRouter(
  cacheRepository: SuggestionCacheRepository,
  cacheKeyBuilder: SuggestionCacheKeyBuilder,
  rankingStrategies: RankingStrategyRegistry
) {
  const router = Router();

  router.get("/suggest", async (req: Request, res: Response, next) => {
    try {
      const { prefix, shouldQuery } = normalizePrefix(req.query.q);
      const rank = readRankingMode(req.query.rank);

      if (!shouldQuery) {
        const response: SuggestResponse = {
          prefix,
          rank,
          suggestions: []
        };
        res.status(200).json(response);
        return;
      }

      const indexVersion = await cacheRepository.getCurrentIndexVersion();
      if (!indexVersion) {
        const response: SuggestResponse = {
          prefix,
          rank,
          suggestions: []
        };
        res.status(200).json(response);
        return;
      }

      const cacheKey = cacheKeyBuilder.build(prefix, indexVersion);
      const cacheEntry = await cacheRepository.get(cacheKey.key);
      const candidates = cacheEntry?.candidates ?? [];
      const suggestions = rankingStrategies
        .get(rank)
        .rank(candidates)
        .slice(0, responseLimit);

      const response: SuggestResponse = {
        prefix,
        rank,
        suggestions
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

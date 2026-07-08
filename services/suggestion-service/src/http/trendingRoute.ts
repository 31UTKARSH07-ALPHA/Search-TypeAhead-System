import { Router, type Request, type Response } from "express";
import type { TrendingResponse } from "@typeahead/shared-types";
import type { RankingStrategyRegistry } from "../ranking/rankingStrategyRegistry.js";
import type { QueryRepository } from "../repositories/queryRepository.js";

const candidateLimit = 100;
const responseLimit = 10;

export function createTrendingRouter(
  queryRepository: QueryRepository,
  rankingStrategies: RankingStrategyRegistry
) {
  const router = Router();

  router.get("/trending", async (_req: Request, res: Response, next) => {
    try {
      const candidates = await queryRepository.findTrendingCandidates(candidateLimit);
      const suggestions = rankingStrategies
        .get("recency")
        .rank(candidates)
        .slice(0, responseLimit);

      const response: TrendingResponse = {
        rank: "recency",
        suggestions
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router, type Request, type Response } from "express";
import type { SearchRequest, SearchResponse } from "@typeahead/shared-types";
import type { SearchEventPublisher } from "../messaging/searchEventPublisher.js";
import { normalizeSearchQuery } from "./query.js";

export function createSearchRouter(searchEventPublisher: SearchEventPublisher) {
  const router = Router();

  router.post("/search", async (req: Request<unknown, unknown, SearchRequest>, res: Response, next) => {
    const query = normalizeSearchQuery(req.body?.query);
    if (!query) {
      res.status(400).json({
        message: "Query is required"
      });
      return;
    }

    try {
      await searchEventPublisher.publish({
        query,
        searchedAt: new Date().toISOString()
      });

      const response: SearchResponse = {
        message: "Searched"
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

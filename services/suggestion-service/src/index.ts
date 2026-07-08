import express, { type Request, type Response } from "express";
import type { HealthResponse } from "@typeahead/shared-types";
import { readConfig } from "./config.js";
import { ConsistentHashRing } from "./cache/consistentHashRing.js";
import { RedisClusterClient } from "./cache/redisClusterClient.js";
import { SuggestionCacheKeyBuilder } from "./cache/suggestionCacheKeyBuilder.js";
import { createCacheDebugRouter } from "./http/cacheDebugRoute.js";
import { createSuggestRouter } from "./http/suggestRoute.js";
import { createTrendingRouter } from "./http/trendingRoute.js";
import { RankingStrategyRegistry } from "./ranking/rankingStrategyRegistry.js";
import { PostgresQueryRepository } from "./repositories/postgresQueryRepository.js";

const app = express();
const config = readConfig();
const queryRepository = new PostgresQueryRepository(config.databaseUrl);
const redisClusterClient = new RedisClusterClient(config.redisClusterNodes);
const hashRing = new ConsistentHashRing({
  bucketCount: config.hashRingBucketCount,
  virtualNodeCount: config.hashRingVirtualNodes
});
const suggestionCacheKeyBuilder = new SuggestionCacheKeyBuilder(hashRing);
const rankingStrategies = new RankingStrategyRegistry();

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  const response: HealthResponse = {
    service: "suggestion-service",
    status: "ok"
  };

  res.status(200).json(response);
});

app.use(createSuggestRouter(redisClusterClient, suggestionCacheKeyBuilder, rankingStrategies));
app.use(createTrendingRouter(queryRepository, rankingStrategies));
app.use(createCacheDebugRouter(redisClusterClient, suggestionCacheKeyBuilder));

app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
  console.error(error);
  res.status(500).json({
    message: "Internal server error"
  });
});

async function shutdown(): Promise<void> {
  await Promise.all([queryRepository.close(), redisClusterClient.close()]);
}

async function start() {
  await redisClusterClient.connect();
  await redisClusterClient.verifyReadWrite();
  const indexVersion = await redisClusterClient.waitForCurrentIndexVersion({
    timeoutMs: config.cacheReadyTimeoutMs,
    pollMs: config.cacheReadyPollMs
  });

  console.log(
    JSON.stringify({
      message: "Suggestion cache index is ready",
      indexVersion
    })
  );

  const server = app.listen(config.port, () => {
    console.log(`suggestion-service listening on ${config.port}`);
  });

  const stop = async () => {
    server.close();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

start().catch((error) => {
  console.error("Failed to start suggestion-service", error);
  void shutdown().finally(() => process.exit(1));
});

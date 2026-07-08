import express, { type Request, type Response } from "express";
import type { HealthResponse, SearchEvent } from "@typeahead/shared-types";
import { SearchBatchFlusher } from "./aggregation/searchBatchFlusher.js";
import { SearchAggregationBuffer } from "./aggregation/searchAggregationBuffer.js";
import { readConfig } from "./config.js";
import { KafkaSearchEventConsumer } from "./messaging/kafkaSearchEventConsumer.js";
import { PostgresQueryCountRepository } from "./repositories/postgresQueryCountRepository.js";

const app = express();
const config = readConfig();
const searchEventConsumer = new KafkaSearchEventConsumer({
  brokers: config.kafkaBrokers,
  topic: config.kafkaTopic,
  groupId: config.kafkaGroupId
});
const searchAggregationBuffer = new SearchAggregationBuffer();
const queryCountRepository = new PostgresQueryCountRepository(config.databaseUrl);
const searchBatchFlusher = new SearchBatchFlusher(searchAggregationBuffer, queryCountRepository, {
  flushIntervalMs: config.flushIntervalMs,
  flushMaxUniqueQueries: config.flushMaxUniqueQueries
});

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  const response: HealthResponse = {
    service: "batch-worker",
    status: "ok"
  };

  res.status(200).json(response);
});

function bufferSearchEvent(event: SearchEvent) {
  searchAggregationBuffer.add(event);
  searchBatchFlusher.flushIfThresholdReached();
}

async function start() {
  await searchEventConsumer.connect();
  await searchEventConsumer.consume(bufferSearchEvent);
  searchBatchFlusher.start();

  const server = app.listen(config.port, () => {
    console.log(`batch-worker health endpoint listening on ${config.port}`);
  });

  const shutdown = async () => {
    searchBatchFlusher.stop();
    await searchBatchFlusher.flushRemaining();
    server.close();
    await searchEventConsumer.close();
    await queryCountRepository.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

start().catch((error) => {
  console.error("Failed to start batch-worker", error);
  process.exit(1);
});

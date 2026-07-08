import express, { type Request, type Response } from "express";
import type { HealthResponse } from "@typeahead/shared-types";
import { readConfig } from "./config.js";
import { createSearchRouter } from "./http/searchRoute.js";
import { KafkaSearchEventPublisher } from "./messaging/kafkaSearchEventPublisher.js";

const app = express();
const config = readConfig();
const searchEventPublisher = new KafkaSearchEventPublisher(
  config.kafkaBrokers,
  config.kafkaTopic
);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  const response: HealthResponse = {
    service: "search-service",
    status: "ok"
  };

  res.status(200).json(response);
});

app.use(createSearchRouter(searchEventPublisher));

app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
  console.error(error);
  res.status(500).json({
    message: "Internal server error"
  });
});

async function start() {
  await searchEventPublisher.connect();

  const server = app.listen(config.port, () => {
    console.log(`search-service listening on ${config.port}`);
  });

  const shutdown = async () => {
    server.close();
    await searchEventPublisher.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

start().catch((error) => {
  console.error("Failed to start search-service", error);
  process.exit(1);
});

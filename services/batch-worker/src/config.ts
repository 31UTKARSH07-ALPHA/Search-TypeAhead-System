export interface BatchWorkerConfig {
  port: number;
  databaseUrl: string;
  kafkaBrokers: string[];
  kafkaTopic: string;
  kafkaGroupId: string;
  flushIntervalMs: number;
  flushMaxUniqueQueries: number;
}

export function readConfig(): BatchWorkerConfig {
  return {
    port: Number(process.env.PORT ?? 4003),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgres://typeahead:typeahead@postgres:5432/typeahead",
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? "kafka:29092")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    kafkaTopic: process.env.KAFKA_TOPIC ?? "search-events",
    kafkaGroupId: process.env.KAFKA_GROUP_ID ?? "batch-worker",
    flushIntervalMs: readPositiveInteger("FLUSH_INTERVAL_MS", 2000),
    flushMaxUniqueQueries: readPositiveInteger("FLUSH_MAX_UNIQUE_QUERIES", 100)
  };
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

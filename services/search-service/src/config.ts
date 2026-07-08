export interface SearchServiceConfig {
  port: number;
  kafkaBrokers: string[];
  kafkaTopic: string;
}

export function readConfig(): SearchServiceConfig {
  return {
    port: Number(process.env.PORT ?? 4001),
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? "kafka:29092")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    kafkaTopic: process.env.KAFKA_TOPIC ?? "search-events"
  };
}

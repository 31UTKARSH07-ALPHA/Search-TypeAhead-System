import { Kafka, logLevel, type Consumer } from "kafkajs";
import type { SearchEvent } from "@typeahead/shared-types";

export interface KafkaSearchEventConsumerOptions {
  brokers: string[];
  topic: string;
  groupId: string;
}

export class KafkaSearchEventConsumer {
  private readonly consumer: Consumer;

  public constructor(private readonly options: KafkaSearchEventConsumerOptions) {
    const kafka = new Kafka({
      clientId: "batch-worker",
      brokers: options.brokers,
      logLevel: logLevel.WARN
    });

    this.consumer = kafka.consumer({
      groupId: options.groupId,
      allowAutoTopicCreation: false
    });
  }

  public async connect(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.options.topic,
      fromBeginning: false
    });
  }

  public async consume(handleEvent: (event: SearchEvent) => void): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const event = parseSearchEvent(message.value?.toString());
        if (!event) {
          console.warn("Skipping malformed search event");
          return;
        }

        handleEvent(event);
      }
    });
  }

  public async close(): Promise<void> {
    await this.consumer.disconnect();
  }
}

function parseSearchEvent(rawValue: string | undefined): SearchEvent | null {
  if (!rawValue) {
    return null;
  }

  let parsed: Partial<SearchEvent>;
  try {
    parsed = JSON.parse(rawValue) as Partial<SearchEvent>;
  } catch {
    return null;
  }

  if (typeof parsed.query !== "string" || typeof parsed.searchedAt !== "string") {
    return null;
  }

  return {
    query: parsed.query,
    searchedAt: parsed.searchedAt
  };
}

import { Kafka, logLevel, type Consumer } from "kafkajs";
import type { SearchEvent } from "@typeahead/shared-types";
import type { SearchEventOffset } from "../aggregation/searchAggregationBuffer.js";

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

  // Auto-commit is off: events only live in the in-memory buffer until a flush, so offsets are
  // committed by commitOffsets() after the batch reaches Postgres. A crash before that replays them.
  public async consume(
    handleEvent: (event: SearchEvent, position: SearchEventOffset) => void,
    handleSkipped: (position: SearchEventOffset) => void
  ): Promise<void> {
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ partition, message }) => {
        const position = { partition, offset: message.offset };
        const event = parseSearchEvent(message.value?.toString());
        if (!event) {
          console.warn("Skipping malformed search event");
          handleSkipped(position);
          return;
        }

        handleEvent(event, position);
      }
    });
  }

  public async commitOffsets(offsets: SearchEventOffset[]): Promise<void> {
    if (offsets.length === 0) {
      return;
    }

    // Kafka stores the offset of the *next* message to read, hence +1.
    await this.consumer.commitOffsets(
      offsets.map(({ partition, offset }) => ({
        topic: this.options.topic,
        partition,
        offset: (BigInt(offset) + 1n).toString()
      }))
    );
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

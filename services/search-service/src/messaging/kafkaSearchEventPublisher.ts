import { Kafka, logLevel, Partitioners, type Producer } from "kafkajs";
import type { SearchEvent } from "@typeahead/shared-types";
import type { SearchEventPublisher } from "./searchEventPublisher.js";

export class KafkaSearchEventPublisher implements SearchEventPublisher {
  private readonly producer: Producer;

  public constructor(
    brokers: string[],
    private readonly topic: string
  ) {
    const kafka = new Kafka({
      clientId: "search-service",
      brokers,
      logLevel: logLevel.WARN
    });

    this.producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: false
    });
  }

  public async connect(): Promise<void> {
    await this.producer.connect();
  }

  public async publish(event: SearchEvent): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: [
        {
          key: event.query,
          value: JSON.stringify(event)
        }
      ]
    });
  }

  public async close(): Promise<void> {
    await this.producer.disconnect();
  }
}

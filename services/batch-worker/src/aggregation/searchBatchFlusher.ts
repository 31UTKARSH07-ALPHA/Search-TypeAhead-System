import type { SearchAggregationBuffer } from "./searchAggregationBuffer.js";
import type { QueryCountRepository } from "../repositories/queryCountRepository.js";

type FlushTrigger = "timer" | "size" | "shutdown";

export interface SearchBatchFlusherOptions {
  flushIntervalMs: number;
  flushMaxUniqueQueries: number;
}

export class SearchBatchFlusher {
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  public constructor(
    private readonly buffer: SearchAggregationBuffer,
    private readonly repository: QueryCountRepository,
    private readonly options: SearchBatchFlusherOptions
  ) {}

  public start(): void {
    this.flushTimer = setInterval(() => {
      void this.flush("timer");
    }, this.options.flushIntervalMs);
  }

  public stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  public flushIfThresholdReached(): void {
    const stats = this.buffer.getStats();
    if (stats.uniqueQueryCount >= this.options.flushMaxUniqueQueries) {
      void this.flush("size");
    }
  }

  public async flushRemaining(): Promise<void> {
    await this.flush("shutdown");
  }

  private async flush(trigger: FlushTrigger): Promise<void> {
    if (this.isFlushing) {
      return;
    }

    const batch = this.buffer.drain();
    if (!batch) {
      return;
    }

    this.isFlushing = true;

    try {
      const upsertCount = await this.repository.upsertCounts(batch.searches);
      console.log(
        JSON.stringify({
          message: "Flushed search batch",
          trigger,
          rawEventsConsumed: batch.rawEventCount,
          uniqueQueryCount: batch.uniqueQueryCount,
          upsertsIssued: upsertCount,
          writesAvoided: batch.rawEventCount - upsertCount,
          writeReductionFactor: Number((batch.rawEventCount / Math.max(upsertCount, 1)).toFixed(2))
        })
      );
    } catch (error) {
      this.buffer.restore(batch);
      console.error("Failed to flush search batch", error);
    } finally {
      this.isFlushing = false;
    }
  }
}

import type { SearchEvent } from "@typeahead/shared-types";

export interface AggregatedSearch {
  query: string;
  count: number;
}

export interface AggregationStats {
  rawEventCount: number;
  uniqueQueryCount: number;
}

// Position of a consumed event in its Kafka partition.
export interface SearchEventOffset {
  partition: number;
  offset: string;
}

export interface AggregatedSearchBatch extends AggregationStats {
  searches: AggregatedSearch[];
  // Highest offset per partition included in this batch; committed only after the batch is persisted.
  offsets: SearchEventOffset[];
}

export class SearchAggregationBuffer {
  private readonly queryCounts = new Map<string, number>();
  private readonly highestOffsets = new Map<number, string>();
  private rawEventCount = 0;

  public add(event: SearchEvent, position: SearchEventOffset): AggregationStats {
    this.rawEventCount += 1;
    this.queryCounts.set(event.query, (this.queryCounts.get(event.query) ?? 0) + 1);
    this.trackOffset(position);

    return this.getStats();
  }

  // Also called for skipped (malformed) events so their offsets get committed with the next batch.
  public trackOffset(position: SearchEventOffset): void {
    const current = this.highestOffsets.get(position.partition);
    if (current === undefined || BigInt(position.offset) > BigInt(current)) {
      this.highestOffsets.set(position.partition, position.offset);
    }
  }

  public getStats(): AggregationStats {
    return {
      rawEventCount: this.rawEventCount,
      uniqueQueryCount: this.queryCounts.size
    };
  }

  public snapshot(): AggregatedSearch[] {
    return Array.from(this.queryCounts.entries()).map(([query, count]) => ({
      query,
      count
    }));
  }

  public drain(): AggregatedSearchBatch | null {
    if (this.rawEventCount === 0) {
      return null;
    }

    const searches = this.snapshot();
    const batch = {
      rawEventCount: this.rawEventCount,
      uniqueQueryCount: searches.length,
      searches,
      offsets: Array.from(this.highestOffsets.entries()).map(([partition, offset]) => ({
        partition,
        offset
      }))
    };

    this.queryCounts.clear();
    this.highestOffsets.clear();
    this.rawEventCount = 0;

    return batch;
  }

  public restore(batch: AggregatedSearchBatch): AggregationStats {
    this.rawEventCount += batch.rawEventCount;

    for (const search of batch.searches) {
      this.queryCounts.set(search.query, (this.queryCounts.get(search.query) ?? 0) + search.count);
    }

    for (const position of batch.offsets) {
      this.trackOffset(position);
    }

    return this.getStats();
  }
}

import type { SearchEvent } from "@typeahead/shared-types";

export interface AggregatedSearch {
  query: string;
  count: number;
}

export interface AggregationStats {
  rawEventCount: number;
  uniqueQueryCount: number;
}

export interface AggregatedSearchBatch extends AggregationStats {
  searches: AggregatedSearch[];
}

export class SearchAggregationBuffer {
  private readonly queryCounts = new Map<string, number>();
  private rawEventCount = 0;

  public add(event: SearchEvent): AggregationStats {
    this.rawEventCount += 1;
    this.queryCounts.set(event.query, (this.queryCounts.get(event.query) ?? 0) + 1);

    return this.getStats();
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
      searches
    };

    this.queryCounts.clear();
    this.rawEventCount = 0;

    return batch;
  }

  public restore(batch: AggregatedSearchBatch): AggregationStats {
    this.rawEventCount += batch.rawEventCount;

    for (const search of batch.searches) {
      this.queryCounts.set(search.query, (this.queryCounts.get(search.query) ?? 0) + search.count);
    }

    return this.getStats();
  }
}

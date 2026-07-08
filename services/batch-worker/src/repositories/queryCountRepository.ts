import type { AggregatedSearch } from "../aggregation/searchAggregationBuffer.js";

export interface QueryCountRepository {
  upsertCounts(searches: AggregatedSearch[]): Promise<number>;
  close(): Promise<void>;
}

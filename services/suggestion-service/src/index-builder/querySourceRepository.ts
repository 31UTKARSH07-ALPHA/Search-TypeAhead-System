import type { SuggestionCandidate } from "@typeahead/shared-types";

export interface IndexSourceOptions {
  // How many queries to take by all-time count.
  topLimit: number;
  // Also take queries searched within this many hours, regardless of count...
  recentWindowHours: number;
  // ...up to this many.
  recentLimit: number;
}

export interface QuerySourceRepository {
  findIndexSourceQueries(options: IndexSourceOptions): Promise<SuggestionCandidate[]>;
  close(): Promise<void>;
}

import type { SuggestionCandidate } from "@typeahead/shared-types";

export interface QuerySourceRepository {
  findTopQueries(limit: number): Promise<SuggestionCandidate[]>;
  close(): Promise<void>;
}

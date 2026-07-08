import type { SuggestionCandidate } from "@typeahead/shared-types";

export interface QueryRepository {
  findByPrefix(prefix: string, limit: number): Promise<SuggestionCandidate[]>;
  findTrendingCandidates(limit: number): Promise<SuggestionCandidate[]>;
  close(): Promise<void>;
}

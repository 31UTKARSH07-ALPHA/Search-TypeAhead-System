import type { SuggestionCandidate } from "@typeahead/shared-types";

export interface SuggestionCacheEntry {
  candidates: SuggestionCandidate[];
}

export interface SuggestionCacheRepository {
  get(cacheKey: string): Promise<SuggestionCacheEntry | null>;
  getCurrentIndexVersion(): Promise<string | null>;
}

import type {
  RankingMode,
  SuggestionCandidate,
  SuggestionResult
} from "@typeahead/shared-types";

export interface RankingStrategy {
  readonly mode: RankingMode;
  rank(candidates: SuggestionCandidate[]): SuggestionResult[];
}

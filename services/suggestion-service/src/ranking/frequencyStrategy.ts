import type { SuggestionCandidate, SuggestionResult } from "@typeahead/shared-types";
import type { RankingStrategy } from "./rankingStrategy.js";

export class FrequencyStrategy implements RankingStrategy {
  readonly mode = "frequency" as const;

  rank(candidates: SuggestionCandidate[]): SuggestionResult[] {
    return candidates
      .map((candidate) => ({
        ...candidate,
        score: candidate.count
      }))
      .sort((left, right) => right.score - left.score || left.query.localeCompare(right.query));
  }
}

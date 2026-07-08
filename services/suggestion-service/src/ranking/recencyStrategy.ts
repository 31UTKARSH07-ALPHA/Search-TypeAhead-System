import type { SuggestionCandidate, SuggestionResult } from "@typeahead/shared-types";
import type { RankingStrategy } from "./rankingStrategy.js";
import { calculateRecencyScore } from "./recencyScore.js";

export class RecencyStrategy implements RankingStrategy {
  readonly mode = "recency" as const;

  rank(candidates: SuggestionCandidate[]): SuggestionResult[] {
    const nowMs = Date.now();

    return candidates
      .map((candidate) => ({
        ...candidate,
        score: calculateRecencyScore(candidate, nowMs)
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.recentCount - left.recentCount ||
          right.count - left.count ||
          left.query.localeCompare(right.query)
      );
  }
}

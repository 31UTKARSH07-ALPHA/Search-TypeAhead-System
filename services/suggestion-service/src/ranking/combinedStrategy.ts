import type { SuggestionCandidate, SuggestionResult } from "@typeahead/shared-types";
import type { RankingStrategy } from "./rankingStrategy.js";
import { calculateRecencyScore } from "./recencyScore.js";

const recencyWeight = 0.1;

export class CombinedStrategy implements RankingStrategy {
  readonly mode = "combined" as const;

  rank(candidates: SuggestionCandidate[]): SuggestionResult[] {
    const nowMs = Date.now();

    return candidates
      .map((candidate) => ({
        ...candidate,
        score: Math.log1p(candidate.count) + recencyWeight * calculateRecencyScore(candidate, nowMs)
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.count - left.count ||
          right.recentCount - left.recentCount ||
          left.query.localeCompare(right.query)
      );
  }
}

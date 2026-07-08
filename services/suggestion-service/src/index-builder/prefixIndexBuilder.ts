import type { SuggestionCandidate } from "@typeahead/shared-types";
import type { RankingStrategy } from "../ranking/rankingStrategy.js";

export interface PrefixIndexBuildOptions {
  minPrefixLength: number;
  maxPrefixLength: number;
  candidatesPerPrefix: number;
}

export class PrefixIndexBuilder {
  public constructor(
    private readonly options: PrefixIndexBuildOptions,
    private readonly rankingStrategies: RankingStrategy[]
  ) {}

  public build(candidates: SuggestionCandidate[]): Map<string, SuggestionCandidate[]> {
    const entriesByPrefix = new Map<string, SuggestionCandidate[]>();
    const maxCandidatesPerPrefix = this.options.candidatesPerPrefix * this.rankingStrategies.length;

    for (const candidate of candidates) {
      const maxLength = Math.min(candidate.query.length, this.options.maxPrefixLength);

      for (let length = this.options.minPrefixLength; length <= maxLength; length += 1) {
        const prefix = candidate.query.slice(0, length);
        const prefixCandidates = entriesByPrefix.get(prefix) ?? [];
        const candidatesWithCurrent = [...prefixCandidates, candidate];
        const selectedCandidates =
          candidatesWithCurrent.length <= maxCandidatesPerPrefix
            ? candidatesWithCurrent
            : this.selectCandidatesForAllRankingModes(candidatesWithCurrent);

        entriesByPrefix.set(prefix, selectedCandidates);
      }
    }

    for (const [prefix, prefixCandidates] of entriesByPrefix.entries()) {
      entriesByPrefix.set(prefix, this.selectCandidatesForAllRankingModes(prefixCandidates));
    }

    return entriesByPrefix;
  }

  private selectCandidatesForAllRankingModes(candidates: SuggestionCandidate[]): SuggestionCandidate[] {
    const selectedByQuery = new Map<string, SuggestionCandidate>();

    for (const strategy of this.rankingStrategies) {
      for (const candidate of strategy.rank(candidates).slice(0, this.options.candidatesPerPrefix)) {
        selectedByQuery.set(candidate.query, toRawCandidate(candidate));
      }
    }

    return Array.from(selectedByQuery.values());
  }
}

function toRawCandidate(candidate: SuggestionCandidate): SuggestionCandidate {
  return {
    query: candidate.query,
    count: candidate.count,
    recentCount: candidate.recentCount,
    lastSeen: candidate.lastSeen
  };
}

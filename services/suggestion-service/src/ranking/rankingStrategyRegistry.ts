import type { RankingMode } from "@typeahead/shared-types";
import { CombinedStrategy } from "./combinedStrategy.js";
import { FrequencyStrategy } from "./frequencyStrategy.js";
import type { RankingStrategy } from "./rankingStrategy.js";
import { RecencyStrategy } from "./recencyStrategy.js";

export class RankingStrategyRegistry {
  private readonly strategies: Map<RankingMode, RankingStrategy>;

  constructor(
    strategies: RankingStrategy[] = [
      new FrequencyStrategy(),
      new RecencyStrategy(),
      new CombinedStrategy()
    ]
  ) {
    this.strategies = new Map(strategies.map((strategy) => [strategy.mode, strategy]));
  }

  get(mode: RankingMode): RankingStrategy {
    const strategy = this.strategies.get(mode);
    if (!strategy) {
      throw new Error(`Unsupported ranking mode: ${mode}`);
    }

    return strategy;
  }
}

import type { SuggestionCandidate } from "@typeahead/shared-types";

const recencyDecayWindowMs = 24 * 60 * 60 * 1000;

export function calculateRecencyScore(
  candidate: SuggestionCandidate,
  nowMs = Date.now()
): number {
  if (candidate.recentCount <= 0 || !candidate.lastSeen) {
    return 0;
  }

  const lastSeenMs = Date.parse(candidate.lastSeen);
  if (Number.isNaN(lastSeenMs)) {
    return 0;
  }

  const ageMs = Math.max(nowMs - lastSeenMs, 0);
  const decayMultiplier = Math.exp(-ageMs / recencyDecayWindowMs);

  return candidate.recentCount * decayMultiplier;
}

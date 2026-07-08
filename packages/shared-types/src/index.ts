export type RankingMode = "frequency" | "recency" | "combined";

export interface SuggestionCandidate {
  query: string;
  count: number;
  recentCount: number;
  lastSeen: string | null;
}

export interface SuggestionResult extends SuggestionCandidate {
  score: number;
}

export interface SuggestResponse {
  prefix: string;
  rank: RankingMode;
  suggestions: SuggestionResult[];
}

export interface TrendingResponse {
  rank: "recency";
  suggestions: SuggestionResult[];
}

export interface SearchRequest {
  query: string;
}

export interface SearchResponse {
  message: "Searched";
}

export interface SearchEvent {
  query: string;
  searchedAt: string;
}

export interface HealthResponse {
  service: string;
  status: "ok";
}

export interface CacheDebugResponse {
  prefix: string;
  cacheKey: string;
  bucket: string;
  indexVersion: string | null;
  redisSlot: number;
  redisNode: string | null;
  hit: boolean;
}

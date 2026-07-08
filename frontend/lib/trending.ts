import type { TrendingResponse } from "@typeahead/shared-types";

export async function fetchTrending(signal?: AbortSignal): Promise<TrendingResponse> {
  const response = await fetch("/trending", {
    signal
  });

  if (!response.ok) {
    throw new Error(`Trending request failed with status ${response.status}`);
  }

  return response.json() as Promise<TrendingResponse>;
}

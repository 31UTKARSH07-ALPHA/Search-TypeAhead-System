import type { SuggestResponse } from "@typeahead/shared-types";

export async function fetchSuggestions(
  prefix: string,
  signal: AbortSignal
): Promise<SuggestResponse> {
  const response = await fetch(`/suggest?q=${encodeURIComponent(prefix)}`, {
    signal
  });

  if (!response.ok) {
    throw new Error(`Suggestion request failed with status ${response.status}`);
  }

  return response.json() as Promise<SuggestResponse>;
}

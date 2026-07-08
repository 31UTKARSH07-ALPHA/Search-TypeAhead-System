import type { SearchRequest, SearchResponse } from "@typeahead/shared-types";

export async function submitSearch(query: string): Promise<SearchResponse> {
  const request: SearchRequest = { query };
  const response = await fetch("/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`);
  }

  return response.json() as Promise<SearchResponse>;
}

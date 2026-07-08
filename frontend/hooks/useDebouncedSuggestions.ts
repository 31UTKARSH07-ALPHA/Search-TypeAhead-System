"use client";

import { useEffect, useState } from "react";
import type { SuggestionResult } from "@typeahead/shared-types";
import { fetchSuggestions } from "../lib/suggestions";

interface SuggestionState {
  suggestions: SuggestionResult[];
  isLoading: boolean;
  error: string | null;
}

const debounceMs = 250;

function normalizePrefix(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function useDebouncedSuggestions(query: string): SuggestionState {
  const [state, setState] = useState<SuggestionState>({
    suggestions: [],
    isLoading: false,
    error: null
  });

  useEffect(() => {
    const prefix = normalizePrefix(query);
    if (prefix.length < 3 || prefix.length > 50) {
      setState({
        suggestions: [],
        isLoading: false,
        error: null
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        isLoading: true,
        error: null
      }));

      fetchSuggestions(prefix, controller.signal)
        .then((result) => {
          setState({
            suggestions: result.suggestions,
            isLoading: false,
            error: null
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          setState({
            suggestions: [],
            isLoading: false,
            error: error instanceof Error ? error.message : "Suggestion request failed"
          });
        });
    }, debounceMs);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  return state;
}

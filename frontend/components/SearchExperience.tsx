"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { useDebouncedSuggestions } from "../hooks/useDebouncedSuggestions";
import { submitSearch } from "../lib/search";
import { fetchTrending } from "../lib/trending";
import type { SuggestionResult } from "@typeahead/shared-types";

export function SearchExperience() {
  const searchInputId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [trending, setTrending] = useState<SuggestionResult[]>([]);
  const [isTrendingLoading, setIsTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const { suggestions, isLoading, error } = useDebouncedSuggestions(query);
  const normalizedQuery = query.trim().replace(/\s+/g, " ").toLowerCase();
  const hasSuggestions = suggestions.length > 0;
  const canShowEmptyState =
    normalizedQuery.length >= 3 &&
    normalizedQuery.length <= 50 &&
    !isLoading &&
    !error &&
    !hasSuggestions;
  const shouldShowStatus = isLoading || Boolean(error) || canShowEmptyState;
  const shouldShowDropdown = isDropdownOpen && hasSuggestions;
  const activeSuggestionId =
    activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  const suggestionRows = useMemo(
    () =>
      suggestions.map((suggestion, index) => ({
        ...suggestion,
        id: `${listboxId}-option-${index}`
      })),
    [listboxId, suggestions]
  );

  useEffect(() => {
    setActiveIndex(-1);
    setIsDropdownOpen(suggestions.length > 0 || shouldShowStatus);
  }, [shouldShowStatus, suggestions]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTrending(controller.signal);

    return () => {
      controller.abort();
    };
  }, []);

  async function loadTrending(signal?: AbortSignal) {
    setIsTrendingLoading(true);
    setTrendingError(null);

    try {
      const response = await fetchTrending(signal);
      setTrending(response.suggestions);
    } catch (error) {
      if (!signal?.aborted) {
        setTrendingError("Unable to load trending searches");
      }
    } finally {
      if (!signal?.aborted) {
        setIsTrendingLoading(false);
      }
    }
  }

  function selectSuggestion(value: string) {
    setQuery(value);
    setActiveIndex(-1);
    setIsDropdownOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!hasSuggestions) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsDropdownOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsDropdownOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1
      );
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex].query);
      return;
    }

    if (event.key === "Escape") {
      setIsDropdownOpen(false);
      setActiveIndex(-1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedQuery || normalizedQuery.length > 100 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSearchMessage(null);
    setSearchError(null);
    setIsDropdownOpen(false);

    try {
      const response = await submitSearch(normalizedQuery);
      setSearchMessage(response.message);
      window.setTimeout(() => {
        void loadTrending();
      }, 2500);
    } catch {
      setSearchError("Search request failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="search-workspace" aria-labelledby="search-heading">
        <div className="workspace-header">
          <h1 id="search-heading">Search Typeahead</h1>
          <span className="result-count">{suggestions.length}</span>
        </div>

        <form className="search-control" onSubmit={handleSubmit}>
          <div className="search-field">
            <label htmlFor={searchInputId}>Search</label>
            <div className="search-input-row">
              <input
                id={searchInputId}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchMessage(null);
                  setSearchError(null);
                }}
                onFocus={() => setIsDropdownOpen(hasSuggestions || shouldShowStatus)}
                onKeyDown={handleKeyDown}
                placeholder="Type a query"
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={
                  shouldShowDropdown || (isDropdownOpen && shouldShowStatus)
                }
                aria-controls={listboxId}
                aria-activedescendant={activeSuggestionId}
              />
              <button type="submit" disabled={!normalizedQuery || isSubmitting}>
                {isSubmitting ? "Searching" : "Search"}
              </button>
            </div>

            {shouldShowDropdown ? (
              <ul id={listboxId} className="suggestion-list" role="listbox">
                {suggestionRows.map((suggestion, index) => (
                  <li
                    id={suggestion.id}
                    key={suggestion.query}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? "is-active" : undefined}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSuggestion(suggestion.query);
                    }}
                  >
                    <span className="suggestion-query">{suggestion.query}</span>
                    <span className="suggestion-count">{suggestion.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {isDropdownOpen && shouldShowStatus ? (
              <div className="suggestion-status" role={error ? "alert" : "status"}>
                {isLoading ? <span>Loading</span> : null}
                {error ? <span>Unable to load suggestions</span> : null}
                {canShowEmptyState ? <span>No matches</span> : null}
              </div>
            ) : null}
          </div>

          {searchMessage ? (
            <div className="search-response" role="status">
              {searchMessage}
            </div>
          ) : null}
          {searchError ? (
            <div className="search-response is-error" role="alert">
              {searchError}
            </div>
          ) : null}
        </form>

        <section className="trending-section" aria-labelledby="trending-heading">
          <div className="section-heading">
            <h2 id="trending-heading">Trending Searches</h2>
            <span>{trending.length}</span>
          </div>

          {isTrendingLoading ? (
            <div className="trending-status" role="status">
              Loading
            </div>
          ) : null}

          {trendingError ? (
            <div className="trending-status is-error" role="alert">
              {trendingError}
            </div>
          ) : null}

          {!isTrendingLoading && !trendingError && trending.length === 0 ? (
            <div className="trending-status" role="status">
              No trending searches
            </div>
          ) : null}

          {trending.length > 0 ? (
            <ol className="trending-list">
              {trending.map((item) => (
                <li key={item.query}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(item.query);
                      setSearchMessage(null);
                      setSearchError(null);
                    }}
                  >
                    <span className="trending-query">{item.query}</span>
                    <span className="trending-meta">
                      {item.recentCount} recent
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </section>
    </main>
  );
}

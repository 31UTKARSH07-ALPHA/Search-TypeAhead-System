export function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const query = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < 1 || query.length > 100) {
    return null;
  }

  return query;
}

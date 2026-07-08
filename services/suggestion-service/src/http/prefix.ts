export interface PrefixValidationResult {
  prefix: string;
  shouldQuery: boolean;
}

export function normalizePrefix(value: unknown): PrefixValidationResult {
  if (typeof value !== "string") {
    return { prefix: "", shouldQuery: false };
  }

  const prefix = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (prefix.length < 3 || prefix.length > 50) {
    return { prefix, shouldQuery: false };
  }

  return { prefix, shouldQuery: true };
}

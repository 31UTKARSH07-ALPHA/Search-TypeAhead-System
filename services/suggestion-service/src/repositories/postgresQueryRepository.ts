import { Pool } from "pg";
import type { SuggestionCandidate } from "@typeahead/shared-types";
import type { QueryRepository } from "./queryRepository.js";

interface QueryRow {
  query: string;
  count: string;
  recent_count: string;
  last_seen: Date | null;
}

export class PostgresQueryRepository implements QueryRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async findByPrefix(prefix: string, limit: number): Promise<SuggestionCandidate[]> {
    const result = await this.pool.query<QueryRow>(
      `
        SELECT query, count, recent_count, last_seen
        FROM queries
        WHERE query LIKE $1
        ORDER BY count DESC
        LIMIT $2
      `,
      [`${prefix}%`, limit]
    );

    return result.rows.map((row) => ({
      query: row.query,
      count: Number(row.count),
      recentCount: Number(row.recent_count),
      lastSeen: row.last_seen?.toISOString() ?? null
    }));
  }

  async findTrendingCandidates(limit: number): Promise<SuggestionCandidate[]> {
    const result = await this.pool.query<QueryRow>(
      `
        SELECT query, count, recent_count, last_seen
        FROM queries
        WHERE recent_count > 0 AND last_seen IS NOT NULL
        ORDER BY recent_count DESC, last_seen DESC, count DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      query: row.query,
      count: Number(row.count),
      recentCount: Number(row.recent_count),
      lastSeen: row.last_seen?.toISOString() ?? null
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

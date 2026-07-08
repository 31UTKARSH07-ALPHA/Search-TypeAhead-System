import { Pool } from "pg";
import type { SuggestionCandidate } from "@typeahead/shared-types";
import type { QuerySourceRepository } from "./querySourceRepository.js";

interface QueryRow {
  query: string;
  count: string;
  recent_count: string;
  last_seen: Date | null;
}

export class PostgresQuerySourceRepository implements QuerySourceRepository {
  private readonly pool: Pool;

  public constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  public async findTopQueries(limit: number): Promise<SuggestionCandidate[]> {
    const result = await this.pool.query<QueryRow>(
      `
        SELECT query, count, recent_count, last_seen
        FROM queries
        ORDER BY count DESC, query ASC
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

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

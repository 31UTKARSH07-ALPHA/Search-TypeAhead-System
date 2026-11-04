import { Pool } from "pg";
import type { SuggestionCandidate } from "@typeahead/shared-types";
import type { IndexSourceOptions, QuerySourceRepository } from "./querySourceRepository.js";

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

  // Top queries by all-time count, plus anything searched recently. Without the second half a new
  // query can't enter the index until its all-time count beats the top-N cutoff, so recency
  // ranking never sees fresh queries. UNION drops rows that appear in both lists.
  public async findIndexSourceQueries(options: IndexSourceOptions): Promise<SuggestionCandidate[]> {
    const result = await this.pool.query<QueryRow>(
      `
        (
          SELECT query, count, recent_count, last_seen
          FROM queries
          ORDER BY count DESC, query ASC
          LIMIT $1
        )
        UNION
        (
          SELECT query, count, recent_count, last_seen
          FROM queries
          WHERE last_seen >= NOW() - make_interval(hours => $2)
          ORDER BY last_seen DESC
          LIMIT $3
        )
      `,
      [options.topLimit, options.recentWindowHours, options.recentLimit]
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

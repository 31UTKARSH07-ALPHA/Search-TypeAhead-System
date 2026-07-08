import { Pool } from "pg";
import type { AggregatedSearch } from "../aggregation/searchAggregationBuffer.js";
import type { QueryCountRepository } from "./queryCountRepository.js";

export class PostgresQueryCountRepository implements QueryCountRepository {
  private readonly pool: Pool;

  public constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  public async upsertCounts(searches: AggregatedSearch[]): Promise<number> {
    if (searches.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const search of searches) {
        await client.query(
          `
            INSERT INTO queries (query, count, recent_count, last_seen)
            VALUES ($1, $2, $2, NOW())
            ON CONFLICT (query)
            DO UPDATE SET
              count = queries.count + EXCLUDED.count,
              recent_count = queries.recent_count + EXCLUDED.recent_count,
              last_seen = NOW()
          `,
          [search.query, search.count]
        );
      }

      await client.query("COMMIT");
      return searches.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

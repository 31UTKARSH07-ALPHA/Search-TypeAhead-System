import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Pool } from "pg";

interface DatasetConfig {
  filePath: string;
  project: string;
  limit: number;
  batchSize: number;
  databaseUrl: string;
}

interface QueryCount {
  query: string;
  count: number;
}

const blockedNamespacePrefixes = [
  "special:",
  "file:",
  "category:",
  "template:",
  "help:",
  "portal:",
  "talk:",
  "user:",
  "wikipedia:",
  "module:",
  "draft:"
];

function readConfig(): DatasetConfig {
  return {
    filePath: process.env.DATASET_FILE ?? "data/raw/pageviews-20260501-000000.gz",
    project: process.env.DATASET_PROJECT ?? "en",
    limit: Number(process.env.DATASET_LIMIT ?? 150_000),
    batchSize: Number(process.env.DATASET_BATCH_SIZE ?? 1_000),
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://typeahead:typeahead@localhost:55432/typeahead"
  };
}

function decodeTitle(title: string): string | null {
  try {
    return decodeURIComponent(title.replace(/_/g, " "));
  } catch {
    return title.replace(/_/g, " ");
  }
}

function normalizeQuery(title: string): string | null {
  const decoded = decodeTitle(title);
  if (!decoded) {
    return null;
  }

  const query = decoded.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < 3 || query.length > 100) {
    return null;
  }

  if (blockedNamespacePrefixes.some((prefix) => query.startsWith(prefix))) {
    return null;
  }

  return query;
}

function parsePageviewLine(line: string, project: string): QueryCount | null {
  const columns = line.split(" ");
  if (columns.length < 3 || columns[0] !== project) {
    return null;
  }

  const query = normalizeQuery(columns[1]);
  if (!query) {
    return null;
  }

  const count = Number(columns[2]);
  if (!Number.isInteger(count) || count <= 0) {
    return null;
  }

  return { query, count };
}

async function readQueryCounts(config: DatasetConfig): Promise<Map<string, number>> {
  const queryCounts = new Map<string, number>();
  const input = createReadStream(config.filePath).pipe(createGunzip());
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    const row = parsePageviewLine(line, config.project);
    if (!row) {
      continue;
    }

    queryCounts.set(row.query, (queryCounts.get(row.query) ?? 0) + row.count);
    if (queryCounts.size >= config.limit) {
      break;
    }
  }

  return queryCounts;
}

function buildUpsertStatement(rows: QueryCount[]) {
  const values: string[] = [];
  const params: Array<string | number> = [];

  rows.forEach((row, index) => {
    const queryParam = index * 2 + 1;
    const countParam = index * 2 + 2;
    values.push(`($${queryParam}, $${countParam}, 0, NULL)`);
    params.push(row.query, row.count);
  });

  return {
    text: `
      INSERT INTO queries (query, count, recent_count, last_seen)
      VALUES ${values.join(", ")}
      ON CONFLICT (query)
      DO UPDATE SET
        count = EXCLUDED.count,
        recent_count = queries.recent_count,
        last_seen = queries.last_seen
    `,
    params
  };
}

async function upsertQueryCounts(
  pool: Pool,
  queryCounts: Map<string, number>,
  batchSize: number
) {
  const rows = [...queryCounts.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((left, right) => right.count - left.count);

  let written = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const statement = buildUpsertStatement(batch);
    await pool.query(statement.text, statement.params);
    written += batch.length;
  }

  return written;
}

async function main() {
  const config = readConfig();
  console.log(`Reading dataset from ${config.filePath}`);
  console.log(`Filtering project=${config.project}, limit=${config.limit}`);

  const queryCounts = await readQueryCounts(config);
  if (queryCounts.size < 100_000) {
    throw new Error(
      `Dataset produced ${queryCounts.size} unique queries; expected at least 100000`
    );
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const written = await upsertQueryCounts(pool, queryCounts, config.batchSize);
    const rowCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM queries"
    );

    console.log(`Loaded ${written} query rows`);
    console.log(`queries table row count: ${rowCount.rows[0]?.count ?? "0"}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

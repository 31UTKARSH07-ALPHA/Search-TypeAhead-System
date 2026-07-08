import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Pool } from "pg";

/**
 * Loads the ORCAS (MS MARCO) click dataset into the same `queries` table the
 * rest of the system already uses, so no downstream code has to change.
 *
 * ORCAS is a tab-separated dump of clicked query/URL pairs, roughly:
 *   [query id]\t[query]\t[document id]\t[clicked url]
 * with one row per click. A query's popularity is therefore the number of rows
 * that mention it. The file has ~18.8M rows / ~10.4M distinct queries and is
 * multi-GB, so this script never holds all queries in Node memory: it streams
 * the file into an UNLOGGED staging table and lets PostgreSQL do the GROUP BY.
 *
 * Modes (ORCAS_MODE or first CLI arg):
 *   inspect  read the first rows, report the detected layout, and exit.
 *   load     stream + aggregate into the target table (default).
 */

interface OrcasConfig {
  filePath: string;
  databaseUrl: string;
  mode: "inspect" | "load";
  /** Explicit 0-based query column, or -1 to auto-detect from a sample. */
  queryColumnIndex: number;
  /** Tri-state header handling: "auto" | "yes" | "no". */
  headerMode: "auto" | "yes" | "no";
  /** Keep only the top-N queries by popularity. 0 = keep everything. */
  topLimit: number;
  minQueryLength: number;
  maxQueryLength: number;
  /** How many staged rows to flush to PostgreSQL per round trip. */
  copyBatchRows: number;
  /** Target table. Override only for testing; the pipeline reads `queries`. */
  targetTable: string;
  /** Empty the target table before inserting (clean migration). */
  truncateTarget: boolean;
  /** How many rows to sample when auto-detecting layout. */
  inspectSampleRows: number;
}

interface DetectedLayout {
  hasHeader: boolean;
  columnCount: number;
  queryColumnIndex: number;
  sampleQueries: string[];
}

const HEADER_TOKENS = new Set([
  "query",
  "queries",
  "qid",
  "query_id",
  "queryid",
  "docid",
  "doc_id",
  "documentid",
  "url",
  "clicked_url",
  "clickurl"
]);

function readConfig(): OrcasConfig {
  const modeArg = process.argv[2];
  const rawMode = (process.env.ORCAS_MODE ?? modeArg ?? "load").toLowerCase();
  const mode = rawMode === "inspect" ? "inspect" : "load";

  return {
    filePath: process.env.ORCAS_FILE ?? "data/raw/orcas.tsv.gz",
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://typeahead:typeahead@localhost:55432/typeahead",
    mode,
    queryColumnIndex: Number(process.env.ORCAS_QUERY_COLUMN ?? -1),
    headerMode: normalizeHeaderMode(process.env.ORCAS_HAS_HEADER),
    topLimit: Number(process.env.ORCAS_LIMIT ?? 0),
    minQueryLength: Number(process.env.ORCAS_MIN_QUERY_LENGTH ?? 3),
    maxQueryLength: Number(process.env.ORCAS_MAX_QUERY_LENGTH ?? 100),
    copyBatchRows: Number(process.env.ORCAS_COPY_BATCH_ROWS ?? 50_000),
    targetTable: process.env.ORCAS_TARGET_TABLE ?? "queries",
    truncateTarget: (process.env.ORCAS_TRUNCATE_TARGET ?? "true") !== "false",
    inspectSampleRows: Number(process.env.ORCAS_INSPECT_SAMPLE_ROWS ?? 20)
  };
}

function normalizeHeaderMode(value: string | undefined): "auto" | "yes" | "no" {
  if (value === "yes" || value === "true") {
    return "yes";
  }
  if (value === "no" || value === "false") {
    return "no";
  }
  return "auto";
}

/**
 * Real search queries, not page titles: keep casing-insensitive popularity but
 * preserve the natural multi-word phrase. No Wikipedia namespace filtering and
 * no stopword stripping — in ORCAS those are legitimate query terms.
 */
function normalizeQuery(raw: string, config: OrcasConfig): string | null {
  const query = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < config.minQueryLength || query.length > config.maxQueryLength) {
    return null;
  }
  return query;
}

function splitRow(line: string): string[] {
  return line.split("\t");
}

function looksLikeHeader(columns: string[]): boolean {
  return columns.some((column) => HEADER_TOKENS.has(column.trim().toLowerCase()));
}

function isProbablyId(value: string): boolean {
  return /^[0-9]+$/.test(value) || /^[A-Z]?\d{3,}$/.test(value.trim());
}

function isProbablyUrl(value: string): boolean {
  return /:\/\//.test(value) || /^www\./i.test(value.trim());
}

/** Score a column by how query-like it is across the sampled rows. */
function scoreQueryColumn(values: string[]): number {
  let score = 0;
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (isProbablyUrl(trimmed) || isProbablyId(trimmed)) {
      score -= 5;
      continue;
    }
    const wordCount = trimmed.split(/\s+/).length;
    // Natural-language queries have multiple words and a moderate length.
    score += Math.min(wordCount, 8) + (trimmed.length <= 80 ? 1 : -2);
  }
  return score;
}

function detectLayout(sampleRows: string[], config: OrcasConfig): DetectedLayout {
  const nonEmpty = sampleRows.filter((line) => line.length > 0);
  if (nonEmpty.length === 0) {
    throw new Error(`No usable rows found in ${config.filePath}`);
  }

  const firstColumns = splitRow(nonEmpty[0]);
  const headerDetected =
    config.headerMode === "yes" ||
    (config.headerMode === "auto" && looksLikeHeader(firstColumns));

  const dataRows = (headerDetected ? nonEmpty.slice(1) : nonEmpty).map(splitRow);
  const columnCount = Math.max(...dataRows.map((columns) => columns.length));

  let queryColumnIndex = config.queryColumnIndex;
  if (queryColumnIndex < 0) {
    if (headerDetected) {
      const headerIndex = firstColumns.findIndex(
        (column) => column.trim().toLowerCase() === "query"
      );
      queryColumnIndex = headerIndex;
    }
    if (queryColumnIndex < 0) {
      // Auto-detect: pick the most query-like column across the sample.
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let column = 0; column < columnCount; column += 1) {
        const values = dataRows.map((columns) => columns[column] ?? "");
        const score = scoreQueryColumn(values);
        if (score > bestScore) {
          bestScore = score;
          queryColumnIndex = column;
        }
      }
    }
  }

  if (queryColumnIndex < 0 || queryColumnIndex >= columnCount) {
    throw new Error(
      `Could not determine the query column (got index ${queryColumnIndex}, ${columnCount} columns). ` +
        `Set ORCAS_QUERY_COLUMN explicitly.`
    );
  }

  const sampleQueries = dataRows
    .map((columns) => columns[queryColumnIndex] ?? "")
    .map((value) => normalizeQuery(value, config))
    .filter((value): value is string => value !== null)
    .slice(0, 5);

  return { hasHeader: headerDetected, columnCount, queryColumnIndex, sampleQueries };
}

async function readSampleRows(config: OrcasConfig): Promise<string[]> {
  const lines = openLines(config.filePath);
  const sample: string[] = [];
  for await (const line of lines) {
    sample.push(line);
    if (sample.length >= config.inspectSampleRows) {
      break;
    }
  }
  return sample;
}

function openLines(filePath: string) {
  const fileStream = createReadStream(filePath);
  const input = filePath.endsWith(".gz") ? fileStream.pipe(createGunzip()) : fileStream;
  return createInterface({ input, crlfDelay: Infinity });
}

async function runInspect(config: OrcasConfig): Promise<void> {
  const sampleRows = await readSampleRows(config);
  const layout = detectLayout(sampleRows, config);

  console.log(
    JSON.stringify(
      {
        message: "ORCAS layout inspection",
        filePath: config.filePath,
        delimiter: "\\t",
        hasHeader: layout.hasHeader,
        columnCount: layout.columnCount,
        queryColumnIndex: layout.queryColumnIndex,
        sampleQueries: layout.sampleQueries
      },
      null,
      2
    )
  );
}

async function ensureTargetTable(pool: Pool, table: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      query TEXT PRIMARY KEY,
      count BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
      recent_count BIGINT NOT NULL DEFAULT 0 CHECK (recent_count >= 0),
      last_seen TIMESTAMPTZ
    )
  `);
}

async function streamIntoStaging(
  pool: Pool,
  config: OrcasConfig,
  queryColumnIndex: number,
  hasHeader: boolean
): Promise<number> {
  await pool.query("DROP TABLE IF EXISTS orcas_staging_raw");
  await pool.query("CREATE UNLOGGED TABLE orcas_staging_raw (query TEXT NOT NULL)");

  const lines = openLines(config.filePath);
  let buffer: string[] = [];
  let stagedRows = 0;
  let isFirstLine = true;

  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    await pool.query("INSERT INTO orcas_staging_raw (query) SELECT unnest($1::text[])", [
      buffer
    ]);
    stagedRows += buffer.length;
    buffer = [];
    if (stagedRows % 1_000_000 < config.copyBatchRows) {
      console.log(`Staged ${stagedRows.toLocaleString("en-US")} click rows...`);
    }
  };

  for await (const line of lines) {
    if (isFirstLine) {
      isFirstLine = false;
      if (hasHeader) {
        continue;
      }
    }
    if (!line) {
      continue;
    }

    const columns = splitRow(line);
    const rawQuery = columns[queryColumnIndex];
    if (rawQuery === undefined) {
      continue;
    }

    const query = normalizeQuery(rawQuery, config);
    if (!query) {
      continue;
    }

    buffer.push(query);
    if (buffer.length >= config.copyBatchRows) {
      await flush();
    }
  }
  await flush();

  return stagedRows;
}

async function aggregateIntoTarget(pool: Pool, config: OrcasConfig): Promise<number> {
  if (config.truncateTarget) {
    await pool.query(`TRUNCATE TABLE ${config.targetTable}`);
  }

  const limitClause = config.topLimit > 0 ? `LIMIT ${config.topLimit}` : "";
  const result = await pool.query(`
    INSERT INTO ${config.targetTable} (query, count, recent_count, last_seen)
    SELECT query, COUNT(*)::bigint AS count, 0, NULL
    FROM orcas_staging_raw
    GROUP BY query
    ORDER BY count DESC
    ${limitClause}
    ON CONFLICT (query) DO UPDATE SET count = EXCLUDED.count
  `);

  await pool.query("DROP TABLE IF EXISTS orcas_staging_raw");
  return result.rowCount ?? 0;
}

async function printSummaryStats(
  pool: Pool,
  config: OrcasConfig,
  stagedRows: number
): Promise<void> {
  const distinct = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${config.targetTable}`
  );

  const wordDistribution = await pool.query<{ num_words: number; queries: string }>(`
    SELECT
      array_length(regexp_split_to_array(query, '\\s+'), 1) AS num_words,
      COUNT(*) AS queries
    FROM ${config.targetTable}
    GROUP BY num_words
    ORDER BY num_words
  `);

  const percentiles = await pool.query<{
    p100: number;
    p99: number;
    p50: number;
    p01: number;
    min: number;
  }>(`
    SELECT
      MAX(count) AS p100,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY count) AS p99,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY count) AS p50,
      percentile_cont(0.01) WITHIN GROUP (ORDER BY count) AS p01,
      MIN(count) AS min
    FROM ${config.targetTable}
  `);

  console.log(
    JSON.stringify(
      {
        message: "ORCAS load summary",
        targetTable: config.targetTable,
        clickRowsStaged: stagedRows,
        distinctQueriesLoaded: Number(distinct.rows[0]?.count ?? 0),
        topLimitApplied: config.topLimit > 0 ? config.topLimit : "none",
        wordCountDistribution: wordDistribution.rows.map((row) => ({
          numWords: row.num_words,
          queries: Number(row.queries)
        })),
        popularityPercentiles: percentiles.rows[0]
      },
      null,
      2
    )
  );
}

async function runLoad(config: OrcasConfig): Promise<void> {
  const sampleRows = await readSampleRows(config);
  const layout = detectLayout(sampleRows, config);
  console.log(
    `Detected query column ${layout.queryColumnIndex} (header=${layout.hasHeader}, columns=${layout.columnCount})`
  );

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await ensureTargetTable(pool, config.targetTable);
    const stagedRows = await streamIntoStaging(
      pool,
      config,
      layout.queryColumnIndex,
      layout.hasHeader
    );
    console.log(`Finished staging ${stagedRows.toLocaleString("en-US")} click rows`);

    const loaded = await aggregateIntoTarget(pool, config);
    console.log(`Aggregated into ${loaded.toLocaleString("en-US")} distinct queries`);

    await printSummaryStats(pool, config, stagedRows);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  console.log(`ORCAS ${config.mode} from ${config.filePath}`);

  if (config.mode === "inspect") {
    await runInspect(config);
    return;
  }
  await runLoad(config);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

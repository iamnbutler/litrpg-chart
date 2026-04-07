/**
 * JSON exporter: reads book data from the SQLite database and writes
 * static JSON files to static/data/{year}.json and static/data/meta.json.
 *
 * Usage: npm run db:export
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { getDb, closeDb } from "../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportFilters {
  authorBlocklist: string[];
  contentFilter: {
    enabled: boolean;
    patterns: string[];
    fields: string[];
  };
  qualityFilter: {
    enabled: boolean;
    minQualityScore: number;
  };
  aiNarrationFilter: {
    enabled: boolean;
    qualityScoreOverride: number;
  };
  subgenreFilter: {
    enabled: boolean;
    excludeProgressionOnlyFallback: boolean;
  };
  regressionGuard: {
    enabled: boolean;
    /** If new data has fewer than this ratio of existing data, abort */
    minBookRatio: number;
  };
}

interface BookRow {
  id: string;
  title: string;
  author: string;
  narrator: string | null;
  release_date: string;
  cover_url: string | null;
  runtime_minutes: number | null;
  description: string;
  url: string | null;
  rating: number | null;
  rating_count: number | null;
  is_ai_narrated: number;
  quality_score: number | null;
  series_id: string | null;
  series_title: string | null;
  series_number: number | null;
  subgenres: string | null; // comma-separated from GROUP_CONCAT
}

interface ExportedBook {
  id: string;
  title: string;
  series: string;
  seriesNumber: number | null;
  author: string;
  narrator?: string;
  releaseDate: string;
  coverUrl?: string;
  audiobookLength?: string;
  subgenres: string[];
  description: string;
  url?: string;
  rating?: number;
  ratingCount?: number;
  relevanceScore: number;
}

interface YearMeta {
  totalBooks: number;
  exportedBooks: number;
}

interface Meta {
  lastUpdated: string;
  years: Record<string, YearMeta>;
  sources: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h !== 1 ? "s" : ""}`;
  return `${h} hr${h !== 1 ? "s" : ""} ${m} min`;
}

function loadFilters(): ExportFilters {
  const raw = readFileSync(
    join(import.meta.dirname, "..", "config", "export-filters.json"),
    "utf-8",
  );
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Query — adapted to match migration schema (001_initial.sql)
// ---------------------------------------------------------------------------

/**
 * Query books for a given year. Joins to series table via series_id FK
 * and aggregates subgenres from book_subgenres (which stores subgenre
 * as a text column, not a FK to a separate table).
 */
function queryBooksByYear(db: Database.Database, year: number): BookRow[] {
  const stmt = db.prepare(`
    SELECT
      b.id,
      b.title,
      b.author,
      b.narrator,
      b.release_date,
      b.cover_url,
      b.runtime_minutes,
      b.description,
      b.url,
      b.rating,
      b.rating_count,
      b.is_ai_narrated,
      b.quality_score,
      b.series_id,
      s.title AS series_title,
      b.series_number,
      GROUP_CONCAT(bsg.subgenre) AS subgenres
    FROM books b
    LEFT JOIN series s ON s.id = b.series_id
    LEFT JOIN book_subgenres bsg ON bsg.book_id = b.id
    WHERE substr(b.release_date, 1, 4) = ?
    GROUP BY b.id
    ORDER BY b.id
  `);

  return stmt.all(String(year)) as BookRow[];
}

function countBooksByYear(db: Database.Database, year: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM books WHERE substr(release_date, 1, 4) = ?`,
    )
    .get(String(year)) as { cnt: number };
  return row.cnt;
}

function getDistinctYears(db: Database.Database): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(release_date, 1, 4) AS year FROM books ORDER BY year`,
    )
    .all() as { year: string }[];
  return rows.map((r) => parseInt(r.year, 10)).filter((y) => !isNaN(y));
}

function getDistinctSources(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT source FROM book_sources ORDER BY source`)
    .all() as { source: string }[];
  return rows.map((r) => r.source);
}

/**
 * Query ALL books across all years (for cross-year series index).
 * Only includes books that belong to a series.
 */
function queryAllSeriesBooks(db: Database.Database): BookRow[] {
  const stmt = db.prepare(`
    SELECT
      b.id,
      b.title,
      b.author,
      b.narrator,
      b.release_date,
      b.cover_url,
      b.runtime_minutes,
      b.description,
      b.url,
      b.rating,
      b.rating_count,
      b.is_ai_narrated,
      b.quality_score,
      b.series_id,
      s.title AS series_title,
      b.series_number,
      GROUP_CONCAT(bsg.subgenre) AS subgenres
    FROM books b
    LEFT JOIN series s ON s.id = b.series_id
    LEFT JOIN book_subgenres bsg ON bsg.book_id = b.id
    WHERE b.series_id IS NOT NULL
    GROUP BY b.id
    ORDER BY b.id
  `);

  return stmt.all() as BookRow[];
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function applyFilters(books: BookRow[], filters: ExportFilters): { filtered: BookRow[]; stats: FilterStats } {
  let result = books;
  const stats: FilterStats = { content: 0, aiNarration: 0, quality: 0, subgenre: 0, contentBreakdown: {} };

  // Author blocklist
  if (filters.authorBlocklist?.length > 0) {
    const blocked = new Set(filters.authorBlocklist.map((a) => a.toLowerCase()));
    const before = result.length;
    result = result.filter((b) => {
      const authors = (b.author ?? "").toLowerCase().split(",").map((s) => s.trim());
      return !authors.some((a) => blocked.has(a));
    });
    stats.content += before - result.length;
    stats.contentBreakdown["author-blocklist"] = before - result.length;
  }

  // Content filter (harem/erotic/romance)
  if (filters.contentFilter.enabled && filters.contentFilter.patterns.length > 0) {
    const compiled = filters.contentFilter.patterns.map((p) => ({
      pattern: p,
      re: new RegExp(p, "i"),
    }));
    result = result.filter((b) => {
      const fields = filters.contentFilter.fields;
      const text = fields.map((f) => (b as unknown as Record<string, unknown>)[f] ?? "").join(" ");
      for (const { pattern, re } of compiled) {
        if (re.test(text)) {
          stats.content++;
          stats.contentBreakdown[pattern] = (stats.contentBreakdown[pattern] ?? 0) + 1;
          return false;
        }
      }
      return true;
    });
  }

  // AI narration filter
  if (filters.aiNarrationFilter.enabled) {
    const before = result.length;
    result = result.filter((b) => {
      if (!b.is_ai_narrated) return true;
      return (
        b.quality_score != null &&
        b.quality_score >= filters.aiNarrationFilter.qualityScoreOverride
      );
    });
    stats.aiNarration = before - result.length;
  }

  // Quality score filter
  if (filters.qualityFilter.enabled && filters.qualityFilter.minQualityScore > 0) {
    const before = result.length;
    result = result.filter(
      (b) =>
        b.quality_score == null ||
        b.quality_score >= filters.qualityFilter.minQualityScore,
    );
    stats.quality = before - result.length;
  }

  // Subgenre filter: exclude books with no subgenres
  if (filters.subgenreFilter.enabled && filters.subgenreFilter.excludeProgressionOnlyFallback) {
    const before = result.length;
    result = result.filter((b) => {
      if (!b.subgenres) return false;
      const subs = b.subgenres.split(",").filter(Boolean);
      return subs.length > 0;
    });
    stats.subgenre = before - result.length;
  }

  return { filtered: result, stats };
}

interface FilterStats {
  content: number;
  aiNarration: number;
  quality: number;
  subgenre: number;
  contentBreakdown: Record<string, number>;
}

function logFilterStats(stats: FilterStats): void {
  const total = stats.content + stats.aiNarration + stats.quality + stats.subgenre;
  if (total === 0) return;
  console.log(`  Filtered ${total} books:`);
  if (stats.content > 0) {
    console.log(`    content: ${stats.content}`);
    for (const [pattern, count] of Object.entries(stats.contentBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${count} matched '${pattern}'`);
    }
  }
  if (stats.aiNarration > 0) console.log(`    ai-narration: ${stats.aiNarration}`);
  if (stats.quality > 0) console.log(`    quality: ${stats.quality}`);
  if (stats.subgenre > 0) console.log(`    subgenre-fallback: ${stats.subgenre}`);
}

// ---------------------------------------------------------------------------
// Series aggregate scores — cross-year reputation for unrated books
// ---------------------------------------------------------------------------

/** Fraction of series score inherited by unrated books (0–1). */
const SERIES_INHERIT_FRACTION = 0.6;

interface SeriesAggregate {
  avgRating: number;
  totalRatings: number;
  bookCount: number;
}

/**
 * Compute aggregate scores for each series across ALL years.
 * Returns a map of series_id → relevance score computed from the
 * series' collective ratings using the same Bayesian formula.
 */
function querySeriesAggregateScores(db: Database.Database): Map<string, number> {
  const rows = db.prepare(`
    SELECT
      b.series_id,
      SUM(b.rating * b.rating_count) AS weighted_sum,
      SUM(b.rating_count) AS total_ratings,
      COUNT(*) AS book_count
    FROM books b
    WHERE b.series_id IS NOT NULL
      AND b.rating IS NOT NULL
      AND b.rating_count > 0
    GROUP BY b.series_id
  `).all() as { series_id: string; weighted_sum: number; total_ratings: number; book_count: number }[];

  if (rows.length === 0) return new Map();

  // Global mean across all series' aggregates
  const totalWeighted = rows.reduce((s, r) => s + r.weighted_sum, 0);
  const totalVotes = rows.reduce((s, r) => s + r.total_ratings, 0);
  const C = totalVotes > 0 ? totalWeighted / totalVotes : 0;

  // Median total ratings per series as confidence threshold
  const counts = rows.map((r) => r.total_ratings).sort((a, b) => a - b);
  const m = counts[Math.floor(counts.length / 2)];

  const scores = new Map<string, number>();
  for (const row of rows) {
    const v = row.total_ratings;
    const R = v > 0 ? row.weighted_sum / v : 0;
    const bayesian = (v * R + m * C) / (v + m);
    scores.set(row.series_id, bayesian * Math.log2(1 + v));
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Relevance scoring — Bayesian weighted rating + series boost
// ---------------------------------------------------------------------------

/**
 * Compute Bayesian weighted rating for a set of books.
 *
 * For rated books:
 *   score = bayesian(R, v) * log2(1 + v)
 *
 * For unrated books in a known series:
 *   score = seriesScore * SERIES_INHERIT_FRACTION
 *
 * Where:
 *   v = this book's rating count
 *   R = this book's average rating
 *   m = confidence threshold (median rating count across all books)
 *   C = global mean rating across all books
 *
 * This pulls low-vote books toward the mean while letting
 * well-reviewed books surface naturally. Series inheritance ensures
 * new releases from popular series (e.g. Dungeon Crawler Carl) get a
 * meaningful baseline instead of ranking at zero.
 */
function computeRelevanceScores(
  books: BookRow[],
  seriesScores: Map<string, number>,
): Map<string, number> {
  const scored = books.filter((b) => b.rating != null && b.rating_count != null && b.rating_count > 0);
  if (scored.length === 0 && seriesScores.size === 0) return new Map();

  // Global mean rating
  const totalRating = scored.reduce((sum, b) => sum + b.rating! * b.rating_count!, 0);
  const totalVotes = scored.reduce((sum, b) => sum + b.rating_count!, 0);
  const C = totalVotes > 0 ? totalRating / totalVotes : 0;

  // Median rating count as confidence threshold
  const counts = scored.map((b) => b.rating_count!).sort((a, b) => a - b);
  const m = counts.length > 0 ? counts[Math.floor(counts.length / 2)] : 0;

  const scores = new Map<string, number>();
  for (const book of books) {
    const v = book.rating_count ?? 0;
    const R = book.rating ?? 0;
    if (v === 0) {
      // Inherit series reputation for unrated books
      const seriesScore = book.series_id ? seriesScores.get(book.series_id) ?? 0 : 0;
      scores.set(book.id, seriesScore * SERIES_INHERIT_FRACTION);
    } else {
      // Bayesian average for quality estimation, multiplied by
      // log2(1 + ratingCount) to reward engagement. This makes a
      // 4.9-star book with 4000 ratings rank well above a 4.9-star
      // book with 20 ratings — which is what a "chart" should do.
      const bayesian = (v * R + m * C) / (v + m);
      scores.set(book.id, bayesian * Math.log2(1 + v));
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

function toExportedBook(row: BookRow, relevanceScore: number): ExportedBook {
  const book: ExportedBook = {
    id: row.id,
    title: row.title,
    series: row.series_title ?? "",
    seriesNumber: row.series_number,
    author: row.author,
    releaseDate: `${row.release_date}T00:00:00Z`,
    subgenres: row.subgenres ? row.subgenres.split(",") : [],
    description: row.description ?? "",
    relevanceScore: Math.round(relevanceScore * 100) / 100,
  };

  if (row.narrator) book.narrator = row.narrator;
  if (row.cover_url) book.coverUrl = row.cover_url;
  if (row.runtime_minutes != null) book.audiobookLength = formatRuntime(row.runtime_minutes);
  if (row.url) book.url = row.url;
  if (row.rating != null) book.rating = row.rating;
  if (row.rating_count != null) book.ratingCount = row.rating_count;

  return book;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

function runExport(): void {
  const outDir = join(import.meta.dirname, "..", "..", "..", "static", "data");
  mkdirSync(outDir, { recursive: true });

  const filters = loadFilters();
  const db = getDb();

  try {
    const years = getDistinctYears(db);
    const sources = getDistinctSources(db);
    const seriesScores = querySeriesAggregateScores(db);
    const meta: Meta = {
      lastUpdated: new Date().toISOString(),
      years: {},
      sources,
    };

    for (const year of years) {
      const totalBooks = countBooksByYear(db, year);
      const rows = queryBooksByYear(db, year);
      const { filtered, stats } = applyFilters(rows, filters);

      // Regression guard: compare against existing data before overwriting
      const outPath = join(outDir, `${year}.json`);
      if (filters.regressionGuard.enabled && existsSync(outPath)) {
        try {
          const existing = JSON.parse(readFileSync(outPath, "utf-8")) as unknown[];
          const ratio = filtered.length / existing.length;
          if (existing.length > 0 && ratio < filters.regressionGuard.minBookRatio) {
            console.error(
              `  REGRESSION: ${year} would drop from ${existing.length} to ${filtered.length} books (${Math.round(ratio * 100)}%). ` +
              `Threshold: ${Math.round(filters.regressionGuard.minBookRatio * 100)}%. Skipping year.`,
            );
            // Preserve existing data
            meta.years[String(year)] = { totalBooks, exportedBooks: existing.length };
            continue;
          }
        } catch {
          // Existing file is corrupt or not JSON — safe to overwrite
        }
      }

      // Compute Bayesian relevance scores and sort by them (descending)
      const scores = computeRelevanceScores(filtered, seriesScores);
      const exported = filtered
        .map((row) => toExportedBook(row, scores.get(row.id) ?? 0))
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      writeFileSync(outPath, JSON.stringify(exported));
      const topScore = exported[0]?.relevanceScore ?? 0;
      const bottomScore = exported[exported.length - 1]?.relevanceScore ?? 0;
      console.log(`${year}: ${exported.length}/${totalBooks} books → ${outPath} (scores: ${topScore}–${bottomScore})`);
      logFilterStats(stats);

      meta.years[String(year)] = {
        totalBooks,
        exportedBooks: exported.length,
      };
    }

    // Export cross-year series index
    const allSeriesBooks = queryAllSeriesBooks(db);
    const { filtered: seriesFiltered } = applyFilters(allSeriesBooks, filters);
    const allScores = computeRelevanceScores(seriesFiltered, seriesScores);
    const seriesIndex: Record<string, ExportedBook[]> = {};
    for (const row of seriesFiltered) {
      const seriesName = row.series_title ?? "";
      if (!seriesName) continue;
      if (!seriesIndex[seriesName]) seriesIndex[seriesName] = [];
      seriesIndex[seriesName].push(toExportedBook(row, allScores.get(row.id) ?? 0));
    }
    // Sort each series by seriesNumber
    for (const books of Object.values(seriesIndex)) {
      books.sort((a, b) => (a.seriesNumber ?? 999) - (b.seriesNumber ?? 999));
    }
    const seriesPath = join(outDir, "series.json");
    writeFileSync(seriesPath, JSON.stringify(seriesIndex));
    const seriesCount = Object.keys(seriesIndex).length;
    const seriesBookCount = Object.values(seriesIndex).reduce((s, b) => s + b.length, 0);
    console.log(`Series index: ${seriesCount} series, ${seriesBookCount} books → ${seriesPath}`);

    const metaPath = join(outDir, "meta.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`Metadata → ${metaPath}`);
  } finally {
    closeDb();
  }
}

runExport();

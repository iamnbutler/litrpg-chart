/**
 * JSON exporter: reads book data from the SQLite database and writes
 * static JSON files to static/data/{year}.json and static/data/meta.json.
 *
 * Usage: npm run db:export
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { getDb, closeDb } from "../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportFilters {
  contentFilter: {
    enabled: boolean;
    pattern: string;
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
      s.title AS series_title,
      b.series_number,
      GROUP_CONCAT(bsg.subgenre) AS subgenres
    FROM books b
    LEFT JOIN series s ON s.id = b.series_id
    LEFT JOIN book_subgenres bsg ON bsg.book_id = b.id
    WHERE substr(b.release_date, 1, 4) = ?
    GROUP BY b.id
    ORDER BY b.release_date ASC
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

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function applyFilters(books: BookRow[], filters: ExportFilters): BookRow[] {
  let result = books;

  // Content filter (harem/erotic)
  if (filters.contentFilter.enabled) {
    const re = new RegExp(filters.contentFilter.pattern, "i");
    result = result.filter((b) => {
      const fields = filters.contentFilter.fields;
      const text = fields.map((f) => (b as unknown as Record<string, unknown>)[f] ?? "").join(" ");
      return !re.test(text);
    });
  }

  // AI narration filter
  if (filters.aiNarrationFilter.enabled) {
    result = result.filter((b) => {
      if (!b.is_ai_narrated) return true;
      // Allow AI-narrated books if quality score is above override threshold
      return (
        b.quality_score != null &&
        b.quality_score >= filters.aiNarrationFilter.qualityScoreOverride
      );
    });
  }

  // Quality score filter
  if (filters.qualityFilter.enabled && filters.qualityFilter.minQualityScore > 0) {
    result = result.filter(
      (b) =>
        b.quality_score == null ||
        b.quality_score >= filters.qualityFilter.minQualityScore,
    );
  }

  // Subgenre filter: exclude books with no subgenre or only "progression" fallback
  if (filters.subgenreFilter.enabled && filters.subgenreFilter.excludeProgressionOnlyFallback) {
    result = result.filter((b) => {
      if (!b.subgenres) return false; // no subgenres at all
      const subs = b.subgenres.split(",");
      // Exclude if the only subgenre is the "progression" fallback
      if (subs.length === 1 && subs[0] === "progression") return false;
      return true;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

function toExportedBook(row: BookRow): ExportedBook {
  const book: ExportedBook = {
    id: row.id,
    title: row.title,
    series: row.series_title ?? "",
    seriesNumber: row.series_number,
    author: row.author,
    releaseDate: `${row.release_date}T00:00:00Z`,
    subgenres: row.subgenres ? row.subgenres.split(",") : [],
    description: row.description ?? "",
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
    const meta: Meta = {
      lastUpdated: new Date().toISOString(),
      years: {},
      sources,
    };

    for (const year of years) {
      const totalBooks = countBooksByYear(db, year);
      const rows = queryBooksByYear(db, year);
      const filtered = applyFilters(rows, filters);
      const exported = filtered.map(toExportedBook);

      const outPath = join(outDir, `${year}.json`);
      writeFileSync(outPath, JSON.stringify(exported));
      console.log(`${year}: ${exported.length}/${totalBooks} books → ${outPath}`);

      meta.years[String(year)] = {
        totalBooks,
        exportedBooks: exported.length,
      };
    }

    const metaPath = join(outDir, "meta.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`Metadata → ${metaPath}`);
  } finally {
    closeDb();
  }
}

runExport();

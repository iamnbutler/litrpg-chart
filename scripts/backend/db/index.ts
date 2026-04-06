/**
 * Database helpers for fetchers.
 * Uses the connection from ../db.ts and writes to the schema from migrations/001_initial.sql.
 */
import { getDb } from "../db.js";

export interface BookRow {
  id: string; // ASIN
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  series_name: string | null; // stored via series table
  series_number: number | null;
  release_date: string | null;
  cover_url: string | null;
  runtime_minutes: number | null;
  rating: number | null;
  rating_count: number | null;
  description: string | null;
  url: string | null;
  is_ai_narrated: boolean;
}

/**
 * Upsert a series row and return its ID.
 * Uses slugified series name as the ID.
 */
function upsertSeries(name: string, author: string | null): string {
  const db = getDb();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  db.prepare(
    `INSERT INTO series (id, title, author)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       author = COALESCE(excluded.author, series.author)`
  ).run(id, name, author);
  return id;
}

export function upsertBook(book: BookRow): boolean {
  const db = getDb();

  // Handle series normalization
  let seriesId: string | null = null;
  if (book.series_name) {
    seriesId = upsertSeries(book.series_name, book.author);
  }

  const existing = db
    .prepare("SELECT id FROM books WHERE id = ?")
    .get(book.id);

  if (existing) {
    db.prepare(
      `UPDATE books SET
        title = @title, subtitle = @subtitle, author = @author,
        narrator = @narrator, series_id = @series_id,
        series_number = @series_number, release_date = @release_date,
        cover_url = @cover_url, runtime_minutes = @runtime_minutes,
        rating = @rating, rating_count = @rating_count,
        description = @description, url = @url,
        is_ai_narrated = @is_ai_narrated,
        updated_at = datetime('now')
      WHERE id = @id`
    ).run({ ...book, series_id: seriesId, is_ai_narrated: book.is_ai_narrated ? 1 : 0 });
    return false; // updated
  } else {
    db.prepare(
      `INSERT INTO books (id, title, subtitle, author, narrator, series_id,
        series_number, release_date, cover_url, runtime_minutes,
        rating, rating_count, description, url, is_ai_narrated)
      VALUES (@id, @title, @subtitle, @author, @narrator, @series_id,
        @series_number, @release_date, @cover_url, @runtime_minutes,
        @rating, @rating_count, @description, @url, @is_ai_narrated)`
    ).run({ ...book, series_id: seriesId, is_ai_narrated: book.is_ai_narrated ? 1 : 0 });
    return true; // new
  }
}

// ---------------------------------------------------------------------------
// Book lookup helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a full book row by ID, or undefined if not found.
 */
export function getBook(bookId: string): BookRow | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT b.id, b.title, b.subtitle, b.author, b.narrator,
              s.title AS series_name, b.series_number,
              b.release_date, b.cover_url, b.runtime_minutes,
              b.rating, b.rating_count, b.description, b.url,
              b.is_ai_narrated
       FROM books b
       LEFT JOIN series s ON s.id = b.series_id
       WHERE b.id = ?`
    )
    .get(bookId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return {
    id: row.id as string,
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? null,
    author: (row.author as string) ?? null,
    narrator: (row.narrator as string) ?? null,
    series_name: (row.series_name as string) ?? null,
    series_number: (row.series_number as number) ?? null,
    release_date: (row.release_date as string) ?? null,
    cover_url: (row.cover_url as string) ?? null,
    runtime_minutes: (row.runtime_minutes as number) ?? null,
    rating: (row.rating as number) ?? null,
    rating_count: (row.rating_count as number) ?? null,
    description: (row.description as string) ?? null,
    url: (row.url as string) ?? null,
    is_ai_narrated: Boolean(row.is_ai_narrated),
  };
}

/**
 * Fetch all book rows from the database.
 */
export function getAllBooks(): BookRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.id, b.title, b.subtitle, b.author, b.narrator,
              s.title AS series_name, b.series_number,
              b.release_date, b.cover_url, b.runtime_minutes,
              b.rating, b.rating_count, b.description, b.url,
              b.is_ai_narrated
       FROM books b
       LEFT JOIN series s ON s.id = b.series_id`
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? null,
    author: (row.author as string) ?? null,
    narrator: (row.narrator as string) ?? null,
    series_name: (row.series_name as string) ?? null,
    series_number: (row.series_number as number) ?? null,
    release_date: (row.release_date as string) ?? null,
    cover_url: (row.cover_url as string) ?? null,
    runtime_minutes: (row.runtime_minutes as number) ?? null,
    rating: (row.rating as number) ?? null,
    rating_count: (row.rating_count as number) ?? null,
    description: (row.description as string) ?? null,
    url: (row.url as string) ?? null,
    is_ai_narrated: Boolean(row.is_ai_narrated),
  }));
}

// ---------------------------------------------------------------------------
// Book source tracking
// ---------------------------------------------------------------------------

export function upsertBookSource(
  bookId: string,
  source: string,
  rawData: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO book_sources (book_id, source, source_id, raw_data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id, source) DO UPDATE SET
       raw_data = excluded.raw_data,
       fetched_at = datetime('now')`
  ).run(bookId, source, bookId, rawData);
}

export function setBookSubgenres(bookId: string, subgenres: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM book_subgenres WHERE book_id = ?").run(bookId);
  const insert = db.prepare(
    "INSERT INTO book_subgenres (book_id, subgenre) VALUES (?, ?)"
  );
  for (const sg of subgenres) {
    insert.run(bookId, sg);
  }
}

export function setBookSubgenresWithMeta(
  bookId: string,
  subgenres: { subgenre: string; confidence: number; source: string }[]
): void {
  const db = getDb();
  db.prepare("DELETE FROM book_subgenres WHERE book_id = ?").run(bookId);
  const insert = db.prepare(
    "INSERT INTO book_subgenres (book_id, subgenre, confidence, source) VALUES (?, ?, ?, ?)"
  );
  for (const sg of subgenres) {
    insert.run(bookId, sg.subgenre, sg.confidence, sg.source);
  }
}

export function insertFetchRun(
  source: string,
  searchKey: string,
  year: number
): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO fetch_runs (source, search_key, year) VALUES (?, ?, ?)"
    )
    .run(source, searchKey, year);
  return Number(result.lastInsertRowid);
}

export function completeFetchRun(
  runId: number,
  pagesFetched: number,
  resultsFound: number
): void {
  const db = getDb();
  db.prepare(
    `UPDATE fetch_runs SET pages_fetched = ?, results_found = ?,
     completed_at = datetime('now'), status = 'completed' WHERE id = ?`
  ).run(pagesFetched, resultsFound, runId);
}

export function upsertSearchCursor(
  source: string,
  searchKey: string,
  year: number,
  isExhausted: boolean
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO search_cursors (source, search_key, year, last_fetched_at, is_exhausted)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(source, search_key, year) DO UPDATE SET
       last_fetched_at = datetime('now'),
       is_exhausted = excluded.is_exhausted`
  ).run(source, searchKey, year, isExhausted ? 1 : 0);
}

export interface SearchCursor {
  last_fetched_at: string;
  is_exhausted: number;
}

export function getSearchCursor(
  source: string,
  searchKey: string,
  year: number
): SearchCursor | undefined {
  const db = getDb();
  return db
    .prepare(
      "SELECT last_fetched_at, is_exhausted FROM search_cursors WHERE source = ? AND search_key = ? AND year = ?"
    )
    .get(source, searchKey, year) as SearchCursor | undefined;
}

import type Database from 'better-sqlite3';

export function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      asin TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      series_name TEXT,
      series_number REAL,
      author TEXT,
      narrator TEXT,
      release_date TEXT,
      cover_url TEXT,
      runtime_minutes INTEGER,
      description TEXT,
      language TEXT,
      rating_average REAL,
      rating_count INTEGER,
      url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      source TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asin) REFERENCES books(asin),
      UNIQUE(asin, source)
    );

    CREATE TABLE IF NOT EXISTS book_subgenres (
      asin TEXT NOT NULL,
      subgenre TEXT NOT NULL,
      PRIMARY KEY (asin, subgenre),
      FOREIGN KEY (asin) REFERENCES books(asin)
    );

    CREATE TABLE IF NOT EXISTS fetch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      search_key TEXT NOT NULL,
      year INTEGER NOT NULL,
      pages_fetched INTEGER NOT NULL DEFAULT 0,
      results_found INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_cursors (
      source TEXT NOT NULL,
      search_key TEXT NOT NULL,
      year INTEGER NOT NULL,
      last_completed_at TEXT,
      is_exhausted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (source, search_key, year)
    );

    CREATE INDEX IF NOT EXISTS idx_books_release_date ON books(release_date);
    CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_name);
    CREATE INDEX IF NOT EXISTS idx_book_sources_asin ON book_sources(asin);
    CREATE INDEX IF NOT EXISTS idx_fetch_runs_source_year ON fetch_runs(source, year);
  `);
}

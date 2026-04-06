-- Database schema for litrpg-chart book data.
-- Used by the JSON exporter and populated by fetchers (Audible, Hardcover, etc.)

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,               -- ASIN or other source ID
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT NOT NULL,
  narrator TEXT,
  release_date TEXT NOT NULL,        -- YYYY-MM-DD
  cover_url TEXT,
  runtime_minutes INTEGER,
  description TEXT DEFAULT '',
  url TEXT,
  source TEXT NOT NULL DEFAULT 'audible',  -- 'audible', 'hardcover', etc.
  is_ai_narrated INTEGER DEFAULT 0,        -- boolean flag
  quality_score REAL,                       -- 0.0–1.0 quality rating
  rating REAL,                              -- average user rating
  rating_count INTEGER,                     -- number of ratings
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS book_series (
  book_id TEXT NOT NULL REFERENCES books(id),
  series_id INTEGER NOT NULL REFERENCES series(id),
  series_number REAL,
  PRIMARY KEY (book_id, series_id)
);

CREATE TABLE IF NOT EXISTS subgenres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE           -- 'litrpg', 'cultivation', etc.
);

CREATE TABLE IF NOT EXISTS book_subgenres (
  book_id TEXT NOT NULL REFERENCES books(id),
  subgenre_id INTEGER NOT NULL REFERENCES subgenres(id),
  PRIMARY KEY (book_id, subgenre_id)
);

-- Seed default subgenres
INSERT OR IGNORE INTO subgenres (name) VALUES
  ('litrpg'), ('cultivation'), ('progression'), ('dungeon'), ('isekai');

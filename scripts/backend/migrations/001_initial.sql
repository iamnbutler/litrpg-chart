-- Canonical book records
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,              -- ASIN (primary identifier)
  title TEXT NOT NULL,
  subtitle TEXT,
  series_id TEXT REFERENCES series(id),
  series_number REAL,               -- supports 1.5, etc.
  author TEXT NOT NULL,
  narrator TEXT,
  release_date TEXT NOT NULL,       -- ISO 8601 date (YYYY-MM-DD)
  cover_url TEXT,
  runtime_minutes INTEGER,
  description TEXT,
  url TEXT,                         -- primary purchase URL
  rating REAL,                      -- 0-5 scale
  rating_count INTEGER,
  is_ai_narrated BOOLEAN DEFAULT FALSE,
  quality_score REAL,               -- computed composite score
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Normalized series
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,              -- slugified series name
  title TEXT NOT NULL,
  author TEXT,
  book_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Subgenre assignments (many-to-many)
CREATE TABLE IF NOT EXISTS book_subgenres (
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  subgenre TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,      -- 0-1, how confident we are
  source TEXT,                      -- which source assigned this
  PRIMARY KEY (book_id, subgenre)
);

-- Raw source data snapshots
CREATE TABLE IF NOT EXISTS book_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  source TEXT NOT NULL,             -- 'audible', 'hardcover', 'royalroad', 'manual'
  source_id TEXT,                   -- ID in the source system
  raw_data TEXT,                    -- JSON blob of original API response
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(book_id, source)
);

-- Track what searches have been run and when
CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  search_key TEXT NOT NULL,         -- keyword or category ID
  year INTEGER,
  pages_fetched INTEGER DEFAULT 0,
  results_found INTEGER DEFAULT 0,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT DEFAULT 'running'     -- 'running', 'completed', 'failed'
);

-- Cursor state for incremental fetching
CREATE TABLE IF NOT EXISTS search_cursors (
  source TEXT NOT NULL,
  search_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_page INTEGER DEFAULT 0,
  last_fetched_at TEXT,
  is_exhausted BOOLEAN DEFAULT FALSE,  -- TRUE if we've seen all pages
  PRIMARY KEY (source, search_key, year)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_books_release ON books(release_date);
CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id);
CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at);
CREATE INDEX IF NOT EXISTS idx_book_sources_source ON book_sources(source);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_source ON fetch_runs(source, search_key, year);

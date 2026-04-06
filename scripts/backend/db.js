import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'books.db');
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Open (or create) the SQLite database with foreign keys enabled.
 */
export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Ensure the migrations tracking table exists.
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Get the list of already-applied migration names.
 */
function getAppliedMigrations(db) {
  return db.prepare('SELECT name FROM migrations ORDER BY id').all().map(r => r.name);
}

/**
 * Get all migration files sorted by name.
 */
function getMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

/**
 * Run all pending migrations. Returns the list of newly applied migration names.
 */
export function migrate(db) {
  ensureMigrationsTable(db);

  const applied = new Set(getAppliedMigrations(db));
  const files = getMigrationFiles();
  const newly = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    });

    runMigration();
    newly.push(file);
    console.log(`Applied migration: ${file}`);
  }

  if (newly.length === 0) {
    console.log('Database is up to date — no migrations to apply.');
  }

  return newly;
}

/**
 * Get the current migration version (name of last applied migration, or null).
 */
export function getMigrationVersion(db) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT name FROM migrations ORDER BY id DESC LIMIT 1').get();
  return row ? row.name : null;
}

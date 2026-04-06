import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(PROJECT_ROOT, "data/books.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!_db) {
		mkdirSync(dirname(DB_PATH), { recursive: true });
		_db = new Database(DB_PATH);
		_db.pragma("journal_mode = WAL");
		_db.pragma("foreign_keys = ON");
	}
	return _db;
}

export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}

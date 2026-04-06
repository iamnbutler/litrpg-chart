import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const DB_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DB_DIR, "books.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) {
		mkdirSync(DB_DIR, { recursive: true });
		db = new Database(DB_PATH);
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

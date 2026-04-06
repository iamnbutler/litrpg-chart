import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

/** Ensure the migrations tracking table exists. */
function ensureMigrationsTable(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at TEXT DEFAULT (datetime('now'))
		)
	`);
}

/** Get the list of already-applied migration names. */
function getAppliedMigrations(db: Database.Database): Set<string> {
	const rows = db.prepare("SELECT name FROM migrations ORDER BY id").all() as { name: string }[];
	return new Set(rows.map((r) => r.name));
}

/** Get all migration SQL files sorted by name. */
function getMigrationFiles(): string[] {
	return readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort();
}

/** Get the current migration version (number of applied migrations). */
export function getMigrationVersion(): number {
	const db = getDb();
	ensureMigrationsTable(db);
	return getAppliedMigrations(db).size;
}

/** Apply all pending migrations. Returns the number of migrations applied. */
export function runMigrations(): number {
	const db = getDb();
	ensureMigrationsTable(db);

	const applied = getAppliedMigrations(db);
	const files = getMigrationFiles();
	let count = 0;

	for (const file of files) {
		if (applied.has(file)) continue;

		const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");

		const applyMigration = db.transaction(() => {
			db.exec(sql);
			db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
		});

		applyMigration();
		console.log(`  Applied: ${file}`);
		count++;
	}

	return count;
}

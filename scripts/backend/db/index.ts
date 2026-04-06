import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.LITRPG_DB_PATH ?? join(__dirname, '..', '..', '..', 'data', 'litrpg.db');

export function openDatabase(): Database.Database {
	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	return db;
}

export function initializeDatabase(db: Database.Database): void {
	const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
	db.exec(schema);
}

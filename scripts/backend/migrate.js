#!/usr/bin/env node
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, migrate, getMigrationVersion } from './db.js';

// Resolve DB path from env or default
const dbPath = process.env.DB_PATH || undefined;

// Ensure the directory for the database file exists
const resolvedPath = dbPath || new URL('../../data/books.db', import.meta.url).pathname;
mkdirSync(dirname(resolvedPath), { recursive: true });

const db = openDatabase(dbPath);

try {
  migrate(db);
  const version = getMigrationVersion(db);
  console.log(`Current migration version: ${version}`);
} finally {
  db.close();
}

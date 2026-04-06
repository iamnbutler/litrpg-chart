import { closeDb, getDb } from "./db.js";

const COMMANDS = ["migrate", "fetch", "export", "stats"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): void {
	console.log("Usage: index.ts <command>");
	console.log(`Commands: ${COMMANDS.join(", ")}`);
	process.exit(1);
}

async function migrate(): Promise<void> {
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const { readdirSync, readFileSync } = await import("node:fs");
	const { resolve, dirname } = await import("node:path");
	const { fileURLToPath } = await import("node:url");

	const __dirname = dirname(fileURLToPath(import.meta.url));
	const migrationsDir = resolve(__dirname, "migrations");

	let files: string[];
	try {
		files = readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();
	} catch {
		console.log("No migrations directory or no migration files found.");
		return;
	}

	if (files.length === 0) {
		console.log("No migration files found.");
		return;
	}

	const applied = new Set(
		db
			.prepare("SELECT name FROM _migrations")
			.all()
			.map((row) => (row as { name: string }).name),
	);

	for (const file of files) {
		if (applied.has(file)) continue;
		const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
		db.exec(sql);
		db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
		console.log(`Applied migration: ${file}`);
	}

	console.log("Migrations up to date.");
}

async function fetch(): Promise<void> {
	getDb();
	console.log("No fetchers configured.");
}

async function exportData(): Promise<void> {
	getDb();
	console.log("No data to export.");
}

async function stats(): Promise<void> {
	const db = getDb();
	const tables = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
		)
		.all() as { name: string }[];

	if (tables.length === 0) {
		console.log("Database is empty (no tables).");
		return;
	}

	console.log("Database tables:");
	for (const { name } of tables) {
		const count = db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get() as { count: number };
		console.log(`  ${name}: ${count.count} rows`);
	}
}

async function main(): Promise<void> {
	const command = process.argv[2] as Command | undefined;

	if (!command || !COMMANDS.includes(command)) {
		usage();
		return;
	}

	try {
		switch (command) {
			case "migrate":
				await migrate();
				break;
			case "fetch":
				await fetch();
				break;
			case "export":
				await exportData();
				break;
			case "stats":
				await stats();
				break;
		}
	} finally {
		closeDb();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

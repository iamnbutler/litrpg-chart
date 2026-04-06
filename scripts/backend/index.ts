import { closeDb, getDb } from "./db.js";
import { getMigrationVersion, runMigrations } from "./migrate.js";

const commands: Record<string, () => void> = {
	migrate() {
		console.log("Running migrations...");
		const count = runMigrations();
		const version = getMigrationVersion();
		if (count === 0) {
			console.log(`Already up to date (version ${version}).`);
		} else {
			console.log(`Applied ${count} migration(s). Now at version ${version}.`);
		}
	},

	fetch() {
		const db = getDb();
		console.log("No fetchers configured.");
		void db;
	},

	export() {
		const db = getDb();
		console.log("No data to export.");
		void db;
	},

	stats() {
		const version = getMigrationVersion();
		console.log(`Migration version: ${version}`);
		const db = getDb();
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name").all() as { name: string }[];
		console.log(`Tables: ${tables.map((t) => t.name).join(", ") || "(none)"}`);
	},
};

function main(): void {
	const subcommand = process.argv[2];

	if (!subcommand || !commands[subcommand]) {
		console.error(
			`Usage: tsx scripts/backend/index.ts <${Object.keys(commands).join("|")}>`
		);
		process.exit(subcommand ? 1 : 0);
	}

	try {
		commands[subcommand]();
	} finally {
		closeDb();
	}
}

main();

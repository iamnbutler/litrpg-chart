import { closeDb, getDb } from "./db.js";

const commands: Record<string, () => void> = {
	migrate() {
		const db = getDb();
		// Future: run numbered SQL migrations from migrations/
		console.log("Migrations complete (no migrations to run).");
		void db;
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
		const db = getDb();
		console.log("Database stats: no tables yet.");
		void db;
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

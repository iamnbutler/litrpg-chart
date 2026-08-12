/**
 * One-time bootstrap seed: convert the v1 static exports (the only data that
 * survived v1's evicted CI cache) into canonical NDJSON.
 *
 * v1 rows carry series NAMES but not series ASINs, and series identity in v2
 * is the ASIN — so seeds get no series link and lastHydratedAt: null. The
 * bootstrap hydration pass restores series links (with ASINs and positions)
 * from the API, and close-series then fills any gaps.
 *
 *   bun src/seed-v1.ts <v1-data-dir> [--data-dir PATH]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCorpus, saveCorpus } from "./store.ts";
import type { BookRecord } from "./types.ts";

interface V1Book {
	id: string;
	title: string;
	author?: string;
	narrator?: string;
	releaseDate?: string;
	coverUrl?: string;
	description?: string;
	rating?: number;
	ratingCount?: number;
}

const [v1Dir, ...rest] = process.argv.slice(2);
if (!v1Dir) {
	console.error("usage: bun src/seed-v1.ts <v1-data-dir> [--data-dir PATH]");
	process.exit(1);
}
const dataDir = rest[0] === "--data-dir" && rest[1] ? resolve(rest[1]) : resolve(import.meta.dir, "..", "..", "..", "data");

const now = new Date().toISOString();
const corpus = loadCorpus(dataDir);
const before = corpus.books.size;

const splitNames = (s: string | undefined): string[] =>
	(s ?? "")
		.split(",")
		.map((n) => n.trim())
		.filter(Boolean);

for (const file of readdirSync(resolve(v1Dir))) {
	if (!/^\d{4}\.json$/.test(file)) continue;
	const rows = JSON.parse(readFileSync(join(resolve(v1Dir), file), "utf8")) as V1Book[];
	for (const row of rows) {
		if (!row.id || corpus.books.has(row.id)) continue;
		const record: BookRecord = {
			asin: row.id,
			title: row.title || null,
			subtitle: null,
			authors: splitNames(row.author),
			narrators: splitNames(row.narrator),
			series: null,
			releaseDate: row.releaseDate ? row.releaseDate.slice(0, 10) : null,
			runtimeMin: null,
			language: "english",
			rating:
				row.rating != null && row.ratingCount != null && row.ratingCount > 0
					? { avg: row.rating, count: row.ratingCount }
					: null,
			coverUrl: row.coverUrl || null,
			description: row.description || null,
			publisher: null,
			aiNarrated: false,
			subgenres: null,
			meta: { firstSeenAt: now, lastHydratedAt: null, sources: ["seed"] },
		};
		corpus.books.set(record.asin, record);
	}
}

saveCorpus(dataDir, corpus);
console.log(`seeded ${corpus.books.size - before} books (corpus now ${corpus.books.size})`);

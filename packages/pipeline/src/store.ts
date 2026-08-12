/**
 * NDJSON store: data/*.ndjson is the canonical database, kept in git.
 *
 * Serialization is deterministic — records sorted by key, fields in schema
 * order — so weekly pipeline commits diff as clean per-book lines.
 * Writes are atomic (tmp file + rename).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	BookRecordSchema,
	CorrectionSchema,
	SeriesRecordSchema,
	type BookRecord,
	type Correction,
	type Corpus,
	type SeriesRecord,
} from "./types.ts";

const FILES = {
	books: "books.ndjson",
	series: "series.ndjson",
	corrections: "corrections.ndjson",
} as const;

function parseLines<T>(
	path: string,
	parse: (raw: unknown, line: number) => T,
): T[] {
	if (!existsSync(path)) return [];
	const out: T[] = [];
	const text = readFileSync(path, "utf8");
	let n = 0;
	for (const line of text.split("\n")) {
		n++;
		const trimmed = line.trim();
		if (!trimmed) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch (err) {
			throw new Error(`${path}:${n}: invalid JSON — ${(err as Error).message}`);
		}
		out.push(parse(raw, n));
	}
	return out;
}

export function loadCorpus(dataDir: string): Corpus {
	const books = new Map<string, BookRecord>();
	for (const rec of parseLines(join(dataDir, FILES.books), (raw, line) => {
		const r = BookRecordSchema.safeParse(raw);
		if (!r.success) throw new Error(`books.ndjson:${line}: ${r.error.message}`);
		return r.data;
	})) {
		if (books.has(rec.asin)) throw new Error(`books.ndjson: duplicate ASIN ${rec.asin}`);
		books.set(rec.asin, rec);
	}

	const series = new Map<string, SeriesRecord>();
	for (const rec of parseLines(join(dataDir, FILES.series), (raw, line) => {
		const r = SeriesRecordSchema.safeParse(raw);
		if (!r.success) throw new Error(`series.ndjson:${line}: ${r.error.message}`);
		return r.data;
	})) {
		if (series.has(rec.asin)) throw new Error(`series.ndjson: duplicate ASIN ${rec.asin}`);
		series.set(rec.asin, rec);
	}

	const corrections = parseLines(join(dataDir, FILES.corrections), (raw, line) => {
		const r = CorrectionSchema.safeParse(raw);
		if (!r.success) throw new Error(`corrections.ndjson:${line}: ${r.error.message}`);
		return r.data;
	});

	return { books, series, corrections };
}

/** Re-encode via the schema so field order is always schema order. */
function stableLine(schema: { parse: (v: unknown) => unknown }, rec: unknown): string {
	return JSON.stringify(schema.parse(rec));
}

function atomicWrite(path: string, content: string): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, path);
}

export function saveCorpus(dataDir: string, corpus: Corpus): void {
	mkdirSync(dataDir, { recursive: true });

	const bookLines = [...corpus.books.values()]
		.sort((a, b) => a.asin.localeCompare(b.asin))
		.map((r) => stableLine(BookRecordSchema, r));
	atomicWrite(join(dataDir, FILES.books), bookLines.join("\n") + (bookLines.length ? "\n" : ""));

	const seriesLines = [...corpus.series.values()]
		.sort((a, b) => a.asin.localeCompare(b.asin))
		.map((r) => stableLine(SeriesRecordSchema, r));
	atomicWrite(join(dataDir, FILES.series), seriesLines.join("\n") + (seriesLines.length ? "\n" : ""));

	// corrections.ndjson is hand-edited: only create it if missing, never rewrite.
	const correctionsPath = join(dataDir, FILES.corrections);
	if (!existsSync(correctionsPath)) atomicWrite(correctionsPath, "");
}

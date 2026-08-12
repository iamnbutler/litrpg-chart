/**
 * Manual corrections, applied at READ time so they always win and never
 * conflict with fetched data in the store. data/corrections.ndjson is
 * hand-edited; each line patches one book or series.
 *
 * Example lines:
 *   {"kind":"series","target":"B0937JMKYV","set":{"include":true,"subgenres":["litrpg","dungeon"]},"note":"flagship"}
 *   {"kind":"book","target":"B0ABC12345","set":{"releaseDate":"2024-03-01"},"note":"API had placeholder 2200 date"}
 */
import type { BookRecord, Correction, Corpus, SeriesRecord } from "./types.ts";
import { BookRecordSchema, SeriesRecordSchema } from "./types.ts";

export function effectiveBook(book: BookRecord, corrections: Correction[]): BookRecord {
	let out = book;
	for (const c of corrections) {
		if (c.kind !== "book" || c.target !== book.asin) continue;
		out = BookRecordSchema.parse({ ...out, ...c.set, asin: book.asin, meta: out.meta });
	}
	return out;
}

export function effectiveSeries(series: SeriesRecord, corrections: Correction[]): SeriesRecord {
	let out = series;
	for (const c of corrections) {
		if (c.kind !== "series" || c.target !== series.asin) continue;
		out = SeriesRecordSchema.parse({ ...out, ...c.set, asin: series.asin });
	}
	return out;
}

/** Corpus view with every correction applied — what classify/export consume. */
export function effectiveCorpus(corpus: Corpus): {
	books: BookRecord[];
	series: Map<string, SeriesRecord>;
} {
	const series = new Map<string, SeriesRecord>();
	for (const [asin, rec] of corpus.series) {
		series.set(asin, effectiveSeries(rec, corpus.corrections));
	}
	return {
		books: [...corpus.books.values()].map((b) => effectiveBook(b, corpus.corrections)),
		series,
	};
}

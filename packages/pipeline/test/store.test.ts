import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus, saveCorpus } from "../src/store.ts";
import { effectiveBook, effectiveSeries } from "../src/corrections.ts";
import type { BookRecord, Corpus, SeriesRecord } from "../src/types.ts";

function book(asin: string, extra: Partial<BookRecord> = {}): BookRecord {
	return {
		asin,
		title: `Book ${asin}`,
		subtitle: null,
		authors: ["Author"],
		narrators: [],
		series: null,
		releaseDate: "2025-01-01",
		runtimeMin: null,
		language: "english",
		rating: null,
		coverUrl: null,
		description: null,
		publisher: null,
		aiNarrated: false,
		subgenres: null,
		meta: { firstSeenAt: "2026-01-01T00:00:00Z", lastHydratedAt: null, sources: ["audible"] },
		...extra,
	};
}

function series(asin: string, extra: Partial<SeriesRecord> = {}): SeriesRecord {
	return {
		asin,
		name: `Series ${asin}`,
		subgenres: [],
		classifiedBy: null,
		include: null,
		lastClosedAt: null,
		...extra,
	};
}

describe("NDJSON store", () => {
	it("round-trips a corpus deterministically, sorted by ASIN", () => {
		const dir = mkdtempSync(join(tmpdir(), "litrpg-store-"));
		const corpus: Corpus = {
			books: new Map([
				["B2", book("B2")],
				["B1", book("B1")],
			]),
			series: new Map([["S1", series("S1")]]),
			corrections: [],
		};
		saveCorpus(dir, corpus);
		const first = readFileSync(join(dir, "books.ndjson"), "utf8");
		expect(first.indexOf('"B1"')).toBeLessThan(first.indexOf('"B2"'));

		const loaded = loadCorpus(dir);
		expect([...loaded.books.keys()]).toEqual(["B1", "B2"]);
		saveCorpus(dir, loaded);
		expect(readFileSync(join(dir, "books.ndjson"), "utf8")).toBe(first);
	});

	it("rejects duplicate ASINs and bad lines with file:line context", () => {
		const dir = mkdtempSync(join(tmpdir(), "litrpg-store-"));
		saveCorpus(dir, { books: new Map([["B1", book("B1")]]), series: new Map(), corrections: [] });
		const line = readFileSync(join(dir, "books.ndjson"), "utf8").trim();
		writeFileSync(join(dir, "books.ndjson"), `${line}\n${line}\n`);
		expect(() => loadCorpus(dir)).toThrow(/duplicate ASIN B1/);
		writeFileSync(join(dir, "books.ndjson"), "not json\n");
		expect(() => loadCorpus(dir)).toThrow(/books\.ndjson:1/);
	});

	it("never rewrites hand-edited corrections.ndjson", () => {
		const dir = mkdtempSync(join(tmpdir(), "litrpg-store-"));
		saveCorpus(dir, { books: new Map(), series: new Map(), corrections: [] });
		writeFileSync(
			join(dir, "corrections.ndjson"),
			'{"kind":"book","target":"B1","set":{"releaseDate":"2024-01-01"},"note":"fix"}\n',
		);
		const loaded = loadCorpus(dir);
		expect(loaded.corrections).toHaveLength(1);
		saveCorpus(dir, loaded);
		expect(readFileSync(join(dir, "corrections.ndjson"), "utf8")).toContain('"note":"fix"');
	});
});

describe("corrections", () => {
	it("book corrections win over stored fields but cannot change identity", () => {
		const b = book("B1", { releaseDate: "2200-01-01" });
		const fixed = effectiveBook(b, [
			{ kind: "book", target: "B1", set: { releaseDate: "2024-06-01", asin: "EVIL" } },
			{ kind: "book", target: "B2", set: { releaseDate: "1999-01-01" } },
		]);
		expect(fixed.releaseDate).toBe("2024-06-01");
		expect(fixed.asin).toBe("B1");
	});

	it("series corrections apply include/subgenres", () => {
		const s = series("S1");
		const fixed = effectiveSeries(s, [
			{ kind: "series", target: "S1", set: { include: true, subgenres: ["litrpg"] } },
		]);
		expect(fixed.include).toBe(true);
		expect(fixed.subgenres).toEqual(["litrpg"]);
	});
});

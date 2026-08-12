import { describe, it, expect } from "vitest";
import { applySourceRecord } from "../src/merge.ts";
import { toSourceRecord } from "../src/audible.ts";
import type { Corpus, SourceRecord } from "../src/types.ts";

const NOW = "2026-08-12T00:00:00.000Z";
const LATER = "2026-08-13T00:00:00.000Z";

function emptyCorpus(): Corpus {
	return { books: new Map(), series: new Map(), corrections: [] };
}

function rec(overrides: Partial<SourceRecord> & { fields?: SourceRecord["fields"] }): SourceRecord {
	return {
		source: "audible",
		asin: "B000TEST00",
		fetchedAt: NOW,
		fields: {},
		isHydration: false,
		...overrides,
	};
}

describe("applySourceRecord", () => {
	it("creates a new book with defaults for unknown fields", () => {
		const corpus = emptyCorpus();
		const book = applySourceRecord(corpus, rec({ fields: { title: "Test Book" } }));
		expect(book.title).toBe("Test Book");
		expect(book.rating).toBeNull();
		expect(book.meta.firstSeenAt).toBe(NOW);
		expect(book.meta.lastHydratedAt).toBeNull();
		expect(corpus.books.size).toBe(1);
	});

	it("never lets a thin response destroy existing data", () => {
		const corpus = emptyCorpus();
		applySourceRecord(
			corpus,
			rec({
				isHydration: true,
				fields: {
					title: "Full Book",
					authors: ["Author A"],
					rating: { avg: 4.8, count: 1000 },
					coverUrl: "https://img/500.jpg",
					description: "A long description of the book.",
					series: { asin: "SERIES1", name: "The Series", position: "1" },
				},
			}),
		);
		// Thin follow-up: says nothing about most fields.
		const after = applySourceRecord(
			corpus,
			rec({ fetchedAt: LATER, fields: { title: "Full Book" } }),
		);
		expect(after.authors).toEqual(["Author A"]);
		expect(after.rating).toEqual({ avg: 4.8, count: 1000 });
		expect(after.coverUrl).toBe("https://img/500.jpg");
		expect(after.series?.asin).toBe("SERIES1");
		expect(after.meta.lastHydratedAt).toBe(NOW); // thin fetch is not hydration
	});

	it("updates volatile fields with real newer values", () => {
		const corpus = emptyCorpus();
		applySourceRecord(corpus, rec({ fields: { rating: { avg: 4.5, count: 100 } } }));
		const after = applySourceRecord(
			corpus,
			rec({ fetchedAt: LATER, fields: { rating: { avg: 4.6, count: 250 } } }),
		);
		expect(after.rating).toEqual({ avg: 4.6, count: 250 });
	});

	it("keeps the longer description", () => {
		const corpus = emptyCorpus();
		applySourceRecord(corpus, rec({ fields: { description: "Short blurb." } }));
		const longer = applySourceRecord(
			corpus,
			rec({ fetchedAt: LATER, fields: { description: "A much longer and more complete blurb." } }),
		);
		expect(longer.description).toContain("much longer");
		const after = applySourceRecord(
			corpus,
			rec({ fetchedAt: LATER, fields: { description: "tiny" } }),
		);
		expect(after.description).toContain("much longer");
	});

	it("auto-registers newly seen series", () => {
		const corpus = emptyCorpus();
		applySourceRecord(
			corpus,
			rec({ fields: { series: { asin: "SER99", name: "New Series", position: "3" } } }),
		);
		expect(corpus.series.get("SER99")?.name).toBe("New Series");
		expect(corpus.series.get("SER99")?.lastClosedAt).toBeNull();
	});

	it("tracks contributing sources without duplicates", () => {
		const corpus = emptyCorpus();
		applySourceRecord(corpus, rec({}));
		const after = applySourceRecord(corpus, rec({ fetchedAt: LATER }));
		expect(after.meta.sources).toEqual(["audible"]);
	});
});

describe("toSourceRecord", () => {
	it("extracts fields and detects Virtual Voice narration", () => {
		const sr = toSourceRecord(
			{
				asin: "B0X",
				title: "Some Book",
				authors: [{ name: "A. Author" }],
				narrators: [{ name: "Virtual Voice" }],
				release_date: "2026-01-15T00:00:00Z",
				rating: { overall_distribution: { display_average_rating: "4.7", num_ratings: 321 } },
				language: "English",
			},
			true,
			NOW,
		);
		expect(sr.fields.aiNarrated).toBe(true);
		expect(sr.fields.narrators).toEqual([]);
		expect(sr.fields.releaseDate).toBe("2026-01-15");
		expect(sr.fields.rating).toEqual({ avg: 4.7, count: 321 });
		expect(sr.fields.language).toBe("english");
	});

	it("omits fields the response does not carry (undefined, not null)", () => {
		const sr = toSourceRecord({ asin: "B0Y" }, false, NOW);
		expect("title" in sr.fields).toBe(false);
		expect("rating" in sr.fields).toBe(false);
		expect("series" in sr.fields).toBe(false);
	});
});

/**
 * CLASSIFY: series-level, keyword-driven.
 *
 * v1 classified each book from its own description and defaulted on half of
 * them; here a series is classified once from the pooled text of all its
 * volumes (name + titles + subtitle-ish descriptions), and every volume
 * inherits. Manual verdicts (classifiedBy: "manual", set via corrections or
 * curation) are never overwritten. Standalone books classify individually.
 */
import type { SubgenrePatterns } from "../config.ts";
import type { Corpus } from "../types.ts";
import type { Subgenre } from "@litrpg/contract";
import { SUBGENRES } from "@litrpg/contract";

export interface ClassifyResult {
	seriesClassified: number;
	seriesWithGenre: number;
	standalonesClassified: number;
}

const VALID = new Set<string>(SUBGENRES);

export function classifyText(patterns: SubgenrePatterns, text: string): Subgenre[] {
	const found: Subgenre[] = [];
	for (const [subgenre, regexes] of Object.entries(patterns)) {
		if (!VALID.has(subgenre)) continue;
		if (regexes.some((re) => re.test(text))) found.push(subgenre as Subgenre);
	}
	return found;
}

export function classify(corpus: Corpus, patterns: SubgenrePatterns): ClassifyResult {
	const result: ClassifyResult = { seriesClassified: 0, seriesWithGenre: 0, standalonesClassified: 0 };

	// Pool text per series.
	const textBySeries = new Map<string, string[]>();
	for (const book of corpus.books.values()) {
		if (!book.series) continue;
		const parts = textBySeries.get(book.series.asin) ?? [];
		if (book.title) parts.push(book.title);
		if (book.subtitle) parts.push(book.subtitle);
		if (book.description) parts.push(book.description);
		textBySeries.set(book.series.asin, parts);
	}

	for (const series of corpus.series.values()) {
		if (series.classifiedBy === "manual") continue;
		const text = [series.name, ...(textBySeries.get(series.asin) ?? [])].join("\n");
		series.subgenres = classifyText(patterns, text);
		series.classifiedBy = "keyword";
		result.seriesClassified++;
		if (series.subgenres.length > 0) result.seriesWithGenre++;
	}

	// Standalones carry their own subgenres (books in series inherit at export).
	for (const book of corpus.books.values()) {
		if (book.series) continue;
		const text = [book.title, book.subtitle, book.description].filter(Boolean).join("\n");
		book.subgenres = classifyText(patterns, text);
		result.standalonesClassified++;
	}

	return result;
}

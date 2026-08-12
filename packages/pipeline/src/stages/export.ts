/**
 * EXPORT: canonical corpus → static JSON for the web app, validated against
 * the contract schemas before anything is written. Filters (blocklist,
 * content patterns, AI narration, genre gate) apply here — never at fetch —
 * so filter changes only ever require a re-export.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import {
	BrowseFileSchema,
	DATA_PATHS,
	MetaSchema,
	SCHEMA_VERSION,
	SeriesIndexSchema,
	YearFileSchema,
	slugify,
	type ExportedBook,
	type Meta,
	type SeriesIndexEntry,
	type Subgenre,
} from "@litrpg/contract";
import { audibleUrl } from "../audible.ts";
import { effectiveCorpus } from "../corrections.ts";
import type { ExportFilters } from "../config.ts";
import type { BookRecord, Corpus, SeriesRecord } from "../types.ts";

export interface ExportResult {
	books: number;
	series: number;
	years: number[];
	dropped: Record<string, number>;
}

/** Bayesian prior: pulls low-vote ratings toward the global mean. */
const PRIOR_WEIGHT = 50;

export function exportData(
	corpus: Corpus,
	filters: ExportFilters,
	outDir: string,
	now: string,
): ExportResult {
	const { books, series } = effectiveCorpus(corpus);
	const contentRes = filters.contentPatterns.map((p) => new RegExp(p, "i"));
	const blocked = new Set(filters.authorBlocklist.map((a) => a.toLowerCase()));

	const dropped: Record<string, number> = {
		unhydrated: 0,
		nonEnglish: 0,
		aiNarrated: 0,
		blockedAuthor: 0,
		contentFilter: 0,
		noGenre: 0,
		excludedSeries: 0,
	};

	// ---- Filter ----
	const kept: Array<{ book: BookRecord; series: SeriesRecord | null; subgenres: Subgenre[] }> = [];
	for (const book of books) {
		if (!book.title || !book.releaseDate) {
			dropped.unhydrated++;
			continue;
		}
		if (book.language !== null && book.language !== "english") {
			dropped.nonEnglish++;
			continue;
		}
		if (book.aiNarrated) {
			dropped.aiNarrated++;
			continue;
		}
		if (book.authors.some((a) => blocked.has(a.toLowerCase()))) {
			dropped.blockedAuthor++;
			continue;
		}
		const text = [book.title, book.subtitle, book.description].filter(Boolean).join(" ");
		if (contentRes.some((re) => re.test(text))) {
			dropped.contentFilter++;
			continue;
		}

		const s = book.series ? (series.get(book.series.asin) ?? null) : null;
		if (s?.include === false) {
			dropped.excludedSeries++;
			continue;
		}
		const subgenres = (book.subgenres?.length ? book.subgenres : (s?.subgenres ?? [])) as Subgenre[];
		const included = s ? s.include === true || subgenres.length > 0 : subgenres.length > 0;
		if (!included) {
			dropped.noGenre++;
			continue;
		}
		kept.push({ book, series: s, subgenres });
	}

	// ---- Score ----
	const rated = kept.filter((k) => k.book.rating && k.book.rating.count > 0);
	const globalMean =
		rated.length === 0
			? 4.0
			: rated.reduce((sum, k) => sum + k.book.rating!.avg, 0) / rated.length;

	const scoreOf = (b: BookRecord): number => {
		if (!b.rating || b.rating.count === 0) return 0;
		const { avg, count } = b.rating;
		const weighted = (count * avg + PRIOR_WEIGHT * globalMean) / (count + PRIOR_WEIGHT);
		return weighted * Math.log2(1 + count);
	};

	const bySeriesBest = new Map<string, number>();
	for (const k of kept) {
		if (!k.book.series) continue;
		const score = scoreOf(k.book);
		const prev = bySeriesBest.get(k.book.series.asin) ?? 0;
		if (score > prev) bySeriesBest.set(k.book.series.asin, score);
	}

	const exported: ExportedBook[] = kept.map((k) => {
		const own = scoreOf(k.book);
		// Unrated volumes (new/preorder) inherit a discounted series-best score
		// so they surface near their siblings instead of sinking to the bottom.
		const relevance =
			own > 0 ? own : k.book.series ? (bySeriesBest.get(k.book.series.asin) ?? 0) * 0.6 : 0;
		return {
			asin: k.book.asin,
			title: k.book.title!,
			authors: k.book.authors,
			narrators: k.book.narrators,
			seriesAsin: k.book.series?.asin ?? null,
			seriesName: k.book.series?.name ?? null,
			seriesPosition: k.book.series?.position ?? null,
			releaseDate: k.book.releaseDate!,
			runtimeMin: k.book.runtimeMin,
			coverUrl: k.book.coverUrl,
			description: k.book.description ?? "",
			url: audibleUrl(k.book.asin),
			rating: k.book.rating?.avg ?? null,
			ratingCount: k.book.rating?.count ?? null,
			subgenres: k.subgenres,
			relevanceScore: Math.round(relevance * 1000) / 1000,
		};
	});

	// ---- Write ----
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	const write = (relPath: string, data: unknown) => {
		const path = join(outDir, relPath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(data), "utf8");
	};

	const byYear = new Map<number, ExportedBook[]>();
	for (const b of exported) {
		const year = Number(b.releaseDate.slice(0, 4));
		byYear.set(year, [...(byYear.get(year) ?? []), b]);
	}
	const years = [...byYear.keys()].sort((a, b) => a - b);
	for (const year of years) {
		const list = byYear.get(year)!.sort((a, b) => b.relevanceScore - a.relevanceScore);
		write(DATA_PATHS.year(year), YearFileSchema.parse(list));
	}

	const bySeries = new Map<string, ExportedBook[]>();
	for (const b of exported) {
		if (!b.seriesAsin) continue;
		bySeries.set(b.seriesAsin, [...(bySeries.get(b.seriesAsin) ?? []), b]);
	}
	const seriesIndex: SeriesIndexEntry[] = [];
	for (const [asin, list] of bySeries) {
		list.sort(bySeriesOrder);
		const yearsOf = list.map((b) => Number(b.releaseDate.slice(0, 4)));
		seriesIndex.push({
			asin,
			name: list[0].seriesName ?? corpus.series.get(asin)?.name ?? asin,
			authors: [...new Set(list.flatMap((b) => b.authors))],
			subgenres: [...new Set(list.flatMap((b) => b.subgenres))],
			bookCount: list.length,
			firstYear: Math.min(...yearsOf),
			lastYear: Math.max(...yearsOf),
			coverUrl: list[0].coverUrl,
		});
		write(DATA_PATHS.browseSeries(asin), BrowseFileSchema.parse(list));
	}
	seriesIndex.sort((a, b) => a.name.localeCompare(b.name));
	write(DATA_PATHS.seriesIndex, SeriesIndexSchema.parse(seriesIndex));

	writeBrowseByPerson(exported, (b) => b.authors, DATA_PATHS.browseAuthor, write);
	writeBrowseByPerson(exported, (b) => b.narrators, DATA_PATHS.browseNarrator, write);

	const meta: Meta = {
		schemaVersion: SCHEMA_VERSION,
		lastUpdated: now,
		years: Object.fromEntries(years.map((y) => [String(y), { count: byYear.get(y)!.length }])),
		totals: { books: exported.length, series: seriesIndex.length },
	};
	write(DATA_PATHS.meta, MetaSchema.parse(meta));

	return { books: exported.length, series: seriesIndex.length, years, dropped };
}

function bySeriesOrder(a: ExportedBook, b: ExportedBook): number {
	const pa = Number.parseFloat(a.seriesPosition ?? "");
	const pb = Number.parseFloat(b.seriesPosition ?? "");
	if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
	return a.releaseDate.localeCompare(b.releaseDate);
}

function writeBrowseByPerson(
	exported: ExportedBook[],
	names: (b: ExportedBook) => string[],
	pathFor: (slug: string) => string,
	write: (relPath: string, data: unknown) => void,
): void {
	const byPerson = new Map<string, ExportedBook[]>();
	for (const b of exported) {
		for (const name of names(b)) {
			const slug = slugify(name);
			if (!slug) continue;
			byPerson.set(slug, [...(byPerson.get(slug) ?? []), b]);
		}
	}
	for (const [slug, list] of byPerson) {
		list.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
		write(pathFor(slug), BrowseFileSchema.parse(list));
	}
}

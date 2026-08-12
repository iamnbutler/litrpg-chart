/**
 * DISCOVER: find new candidate books via cheap catalog searches.
 *
 * Keyword slices (litrpg, gamelit, …) are genre-scoped — accept everything.
 * Category browses (all of Fantasy sorted by release date) are broad — accept
 * only products whose text matches a subgenre pattern, or that belong to a
 * series we already track.
 *
 * Search responses are rich (title/contributors/series/rating), so known
 * books get a free light merge — ratings refresh without hydration requests.
 */
import type { AudibleClient } from "../audible.ts";
import { toSourceRecord } from "../audible.ts";
import { applySourceRecord } from "../merge.ts";
import type { PipelineConfig, SubgenrePatterns } from "../config.ts";
import type { Corpus } from "../types.ts";

export interface DiscoverResult {
	queriesRun: number;
	productsSeen: number;
	newBooks: number;
	refreshedBooks: number;
}

export function matchesAnySubgenre(patterns: SubgenrePatterns, text: string): boolean {
	for (const regexes of Object.values(patterns)) {
		for (const re of regexes) {
			if (re.test(text)) return true;
		}
	}
	return false;
}

export async function discover(
	corpus: Corpus,
	client: AudibleClient,
	config: PipelineConfig,
	patterns: SubgenrePatterns,
	now: string,
	log: (msg: string) => void,
): Promise<DiscoverResult> {
	const result: DiscoverResult = { queriesRun: 0, productsSeen: 0, newBooks: 0, refreshedBooks: 0 };

	const slices: Array<{ label: string; query: { keywords?: string; categoryId?: string }; pages: number; filtered: boolean }> = [
		...config.discovery.keywords.map((k) => ({
			label: `keywords:${k.q}`,
			query: { keywords: k.q },
			pages: k.pages,
			filtered: false,
		})),
		...config.discovery.categories.map((c) => ({
			label: `category:${c.name}`,
			query: { categoryId: c.id },
			pages: c.pages,
			filtered: true,
		})),
	];

	for (const slice of slices) {
		for (let page = 0; page < slice.pages; page++) {
			const { products } = await client.search({ ...slice.query, page, sortBy: "-ReleaseDate" });
			result.queriesRun++;
			result.productsSeen += products.length;

			for (const p of products) {
				if (!p.asin) continue;
				const known = corpus.books.has(p.asin);
				if (!known && slice.filtered) {
					const text = [p.title, p.subtitle, p.merchandising_summary, p.publisher_summary]
						.filter(Boolean)
						.join(" ");
					const knownSeries = p.series?.[0]?.asin && corpus.series.has(p.series[0].asin);
					if (!knownSeries && !matchesAnySubgenre(patterns, text)) continue;
				}
				if (p.language && p.language.toLowerCase() !== "english") continue;

				applySourceRecord(corpus, toSourceRecord(p, false, now));
				if (known) result.refreshedBooks++;
				else result.newBooks++;
			}
			if (products.length === 0) break; // genuinely past the end of results
		}
		log(`discover ${slice.label}: done (${result.newBooks} new so far)`);
	}

	return result;
}

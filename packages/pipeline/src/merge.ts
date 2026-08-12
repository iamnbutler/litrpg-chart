/**
 * The single write path into the canonical corpus.
 *
 * Merge rules (the v1 postmortem, condensed):
 * - A source saying nothing about a field (undefined) never touches it.
 * - null / empty-array never overwrites a real value. A thin API response
 *   can only ever add data, not destroy it.
 * - Volatile fields (rating) update freely with real values — newer wins.
 * - Series links are add/update-only: a response missing series data
 *   cannot unlink a book from its series.
 */
import type { BookRecord, Corpus, SeriesRecord, SourceRecord } from "./types.ts";

function keepExisting<T>(existing: T | null, incoming: T | null | undefined): T | null {
	if (incoming === undefined || incoming === null) return existing;
	return incoming;
}

function keepExistingList(existing: string[], incoming: string[] | undefined): string[] {
	if (!incoming || incoming.length === 0) return existing;
	return incoming;
}

export function applySourceRecord(corpus: Corpus, rec: SourceRecord): BookRecord {
	const existing = corpus.books.get(rec.asin);
	const f = rec.fields;

	const base: BookRecord = existing ?? {
		asin: rec.asin,
		title: null,
		subtitle: null,
		authors: [],
		narrators: [],
		series: null,
		releaseDate: null,
		runtimeMin: null,
		language: null,
		rating: null,
		coverUrl: null,
		description: null,
		publisher: null,
		aiNarrated: false,
		subgenres: null,
		meta: { firstSeenAt: rec.fetchedAt, lastHydratedAt: null, sources: [] },
	};

	const merged: BookRecord = {
		...base,
		title: keepExisting(base.title, f.title),
		subtitle: keepExisting(base.subtitle, f.subtitle),
		authors: keepExistingList(base.authors, f.authors),
		narrators: keepExistingList(base.narrators, f.narrators),
		series: f.series != null ? f.series : base.series,
		releaseDate: keepExisting(base.releaseDate, f.releaseDate),
		runtimeMin: keepExisting(base.runtimeMin, f.runtimeMin),
		language: keepExisting(base.language, f.language),
		rating: f.rating != null ? f.rating : base.rating,
		coverUrl: keepExisting(base.coverUrl, f.coverUrl),
		description: pickLonger(base.description, f.description),
		publisher: keepExisting(base.publisher, f.publisher),
		aiNarrated: f.aiNarrated ?? base.aiNarrated,
		meta: {
			firstSeenAt: base.meta.firstSeenAt,
			lastHydratedAt: rec.isHydration ? rec.fetchedAt : base.meta.lastHydratedAt,
			sources: base.meta.sources.includes(rec.source)
				? base.meta.sources
				: [...base.meta.sources, rec.source],
		},
	};

	corpus.books.set(rec.asin, merged);

	// Keep the series table in sync with any series link we just learned.
	if (merged.series) ensureSeries(corpus, merged.series.asin, merged.series.name);

	return merged;
}

/** Descriptions vary by response group; keep the most complete one we've seen. */
function pickLonger(existing: string | null, incoming: string | undefined): string | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	return incoming.length > existing.length ? incoming : existing;
}

export function ensureSeries(corpus: Corpus, asin: string, name: string): SeriesRecord {
	const existing = corpus.series.get(asin);
	if (existing) {
		// Series titles occasionally get cleaned up on Audible's side; take
		// the newer name but never blank it.
		if (name && name !== existing.name) existing.name = name;
		return existing;
	}
	const created: SeriesRecord = {
		asin,
		name,
		subgenres: [],
		classifiedBy: null,
		include: null,
		lastClosedAt: null,
	};
	corpus.series.set(asin, created);
	return created;
}

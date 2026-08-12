/**
 * Typed fetchers over the static data files the pipeline exports.
 * Paths come from the contract so pipeline and web can never disagree.
 */
import { base } from '$app/paths';
import { DATA_PATHS, type ExportedBook, type Meta, type SeriesIndex } from '@litrpg/contract';

type FetchFn = typeof globalThis.fetch;

async function getJson<T>(relPath: string, fetchFn: FetchFn): Promise<T | null> {
	const res = await fetchFn(`${base}/data/${relPath}`);
	if (!res.ok) return null;
	return res.json() as Promise<T>;
}

export function fetchMeta(fetchFn: FetchFn = fetch): Promise<Meta | null> {
	return getJson<Meta>(DATA_PATHS.meta, fetchFn);
}

export async function fetchYearBooks(year: number, fetchFn: FetchFn = fetch): Promise<ExportedBook[]> {
	return (await getJson<ExportedBook[]>(DATA_PATHS.year(year), fetchFn)) ?? [];
}

export function fetchSeriesIndex(fetchFn: FetchFn = fetch): Promise<SeriesIndex | null> {
	return getJson<SeriesIndex>(DATA_PATHS.seriesIndex, fetchFn);
}

export async function fetchSeriesBooks(seriesAsin: string, fetchFn: FetchFn = fetch): Promise<ExportedBook[]> {
	return (await getJson<ExportedBook[]>(DATA_PATHS.browseSeries(seriesAsin), fetchFn)) ?? [];
}

export async function fetchAuthorBooks(slug: string, fetchFn: FetchFn = fetch): Promise<ExportedBook[]> {
	return (await getJson<ExportedBook[]>(DATA_PATHS.browseAuthor(slug), fetchFn)) ?? [];
}

export async function fetchNarratorBooks(slug: string, fetchFn: FetchFn = fetch): Promise<ExportedBook[]> {
	return (await getJson<ExportedBook[]>(DATA_PATHS.browseNarrator(slug), fetchFn)) ?? [];
}

import { base } from '$app/paths';
import type { Book } from './types';

/**
 * Fetch books for a given year from pre-built static JSON.
 * Data is generated at build time by scripts/fetch-data.js.
 */
export async function fetchAllBooks(year: number): Promise<Book[]> {
	const res = await fetch(`${base}/data/${year}.json`);
	if (!res.ok) return [];
	return res.json();
}

interface MetaYear {
	totalBooks: number;
	exportedBooks: number;
}

interface Meta {
	lastUpdated: string;
	years: Record<string, MetaYear>;
	sources: string[];
}

export async function fetchMeta(): Promise<Meta | null> {
	const res = await fetch(`${base}/data/meta.json`);
	if (!res.ok) return null;
	return res.json();
}

/** Cached series index (loaded once on first series/author/narrator click) */
let seriesIndexCache: Record<string, Book[]> | null = null;

async function loadSeriesIndex(): Promise<Record<string, Book[]>> {
	if (seriesIndexCache) return seriesIndexCache;
	const res = await fetch(`${base}/data/series.json`);
	if (!res.ok) return {};
	seriesIndexCache = await res.json();
	return seriesIndexCache!;
}

/** Fetch all books for a given series across all years. */
export async function fetchSeriesBooks(seriesName: string): Promise<Book[]> {
	const index = await loadSeriesIndex();
	return index[seriesName] ?? [];
}

/** Fetch all books by a given author across all years. */
export async function fetchAuthorBooks(authorName: string): Promise<Book[]> {
	const index = await loadSeriesIndex();
	const name = authorName.toLowerCase();
	const results: Book[] = [];
	const seen = new Set<string>();
	for (const books of Object.values(index)) {
		for (const b of books) {
			if (!seen.has(b.id) && b.author.toLowerCase().split(',').some(a => a.trim() === name)) {
				seen.add(b.id);
				results.push(b);
			}
		}
	}
	return results;
}

/** Fetch all books by a given narrator across all years. */
export async function fetchNarratorBooks(narratorName: string): Promise<Book[]> {
	const index = await loadSeriesIndex();
	const name = narratorName.toLowerCase();
	const results: Book[] = [];
	const seen = new Set<string>();
	for (const books of Object.values(index)) {
		for (const b of books) {
			if (!seen.has(b.id) && b.narrator?.toLowerCase().split(',').some(n => n.trim() === name)) {
				seen.add(b.id);
				results.push(b);
			}
		}
	}
	return results;
}

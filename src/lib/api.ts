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

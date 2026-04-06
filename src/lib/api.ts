import type { Book } from './types';

/**
 * Genre keyword searches to run against Audible's catalog API.
 * We search multiple terms to cover the LitRPG/progression space broadly.
 */
const GENRE_SEARCHES = [
	'litrpg',
	'progression fantasy',
	'cultivation fantasy',
	'gamelit',
	'dungeon core audiobook',
];

interface AudibleProduct {
	asin: string;
	title: string;
	subtitle?: string;
	authors: { asin?: string; name: string }[];
	narrators: { name: string }[];
	series?: { asin: string; title: string; sequence?: string; url?: string }[];
	release_date: string;
	publication_datetime?: string;
	runtime_length_min?: number;
	language: string;
	merchandising_summary?: string;
	publisher_name?: string;
	product_images?: Record<string, string>;
	rating?: {
		overall_distribution?: {
			average_rating: number;
			num_ratings: number;
		};
	};
}

interface AudibleResponse {
	products: AudibleProduct[];
	total_results?: number;
}

const AUDIBLE_API = 'https://api.audible.com/1.0/catalog/products';

/**
 * Fetch a page of results from Audible's catalog API.
 */
async function fetchAudiblePage(
	keywords: string,
	page: number,
	numResults: number = 50
): Promise<AudibleResponse> {
	const params = new URLSearchParams({
		keywords,
		num_results: String(numResults),
		page: String(page),
		products_sort_by: '-ReleaseDate',
		response_groups: 'product_attrs,contributors,series,media,rating',
		image_sizes: '500'
	});

	const res = await fetch(`${AUDIBLE_API}?${params}`);
	if (!res.ok) {
		throw new Error(`Audible API error: ${res.status}`);
	}
	return res.json();
}

/**
 * Strip HTML tags from description text.
 */
function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#xa0;/g, ' ')
		.replace(/&#39;/g, "'")
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Convert runtime in minutes to a human-readable string.
 */
function formatRuntime(mins: number): string {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h} hrs`;
	return `${h} hrs ${m} min`;
}

/**
 * Guess subgenres from title, subtitle, and description text.
 */
function guessSubgenres(product: AudibleProduct): Book['subgenres'] {
	const text = [
		product.title,
		product.subtitle,
		product.merchandising_summary
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	const subgenres: Book['subgenres'] = [];

	if (/litrpg|lit[\s-]?rpg|gamelit/.test(text)) subgenres.push('litrpg');
	if (/cultivation|cultivator|qi |dao |xianxia|wuxia/.test(text)) subgenres.push('cultivation');
	if (/progression\s*fantasy|level\s*up|skill\s*tree|class\s*system/.test(text)) subgenres.push('progression');
	if (/dungeon\s*core|dungeon\s*crawl/.test(text)) subgenres.push('dungeon');
	if (/isekai|transported|reincarnated|reborn\s*(in|as|into)|summoned\s*(to|into)|another\s*world/.test(text)) subgenres.push('isekai');
	// Default: at least tag as progression if nothing matched
	if (subgenres.length === 0) subgenres.push('progression');

	return subgenres;
}

/**
 * Convert an Audible product to our Book type.
 */
function productToBook(p: AudibleProduct): Book {
	const series = p.series?.[0];
	let seriesNumber: number | null = null;
	if (series?.sequence) {
		const num = parseFloat(series.sequence);
		if (!isNaN(num)) seriesNumber = num;
	}

	return {
		id: p.asin,
		title: p.title + (p.subtitle ? `: ${p.subtitle}` : ''),
		series: series?.title ?? '',
		seriesNumber,
		author: p.authors.map((a) => a.name).join(', '),
		narrator: p.narrators.map((n) => n.name).join(', ') || undefined,
		releaseDate: p.publication_datetime ?? `${p.release_date}T00:00:00Z`,
		coverUrl: p.product_images?.['500'],
		audiobookLength: p.runtime_length_min ? formatRuntime(p.runtime_length_min) : undefined,
		subgenres: guessSubgenres(p),
		description: p.merchandising_summary ? stripHtml(p.merchandising_summary) : '',
		url: `https://www.audible.com/pd/${p.asin}`
	};
}

/**
 * Filter out harem/erotic content based on title, subtitle, and description keywords.
 */
function isHaremOrErotic(p: AudibleProduct): boolean {
	const text = [p.title, p.subtitle, p.merchandising_summary]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return /harem|haremlit|reverse\s*harem|men'?s\s*adventure|smut|erotic|\bspicy\b|adult\s*fantasy\s*romance|intimate\s*scene/i.test(text);
}

/**
 * Fetch audiobooks for a given year from Audible.
 * Searches multiple genre keywords, deduplicates by ASIN, filters to English and target year.
 */
export async function fetchAllBooks(year: number): Promise<Book[]> {
	const seen = new Set<string>();
	const allBooks: Book[] = [];

	for (const keyword of GENRE_SEARCHES) {
		try {
			// Fetch first 2 pages (100 results) per keyword, sorted by newest
			for (let page = 1; page <= 2; page++) {
				const data = await fetchAudiblePage(keyword, page);

				for (const p of data.products) {
					// Skip duplicates, non-English, harem/erotic content
					if (seen.has(p.asin)) continue;
					if (p.language !== 'english') continue;
					if (isHaremOrErotic(p)) continue;

					const releaseYear = new Date(p.release_date).getFullYear();
					if (releaseYear !== year) continue;

					seen.add(p.asin);
					allBooks.push(productToBook(p));
				}

				// If the oldest result on this page is already before our year, stop paginating
				const lastProduct = data.products[data.products.length - 1];
				if (lastProduct && new Date(lastProduct.release_date).getFullYear() < year) {
					break;
				}

				// Small delay between pages
				if (page < 2) {
					await new Promise((r) => setTimeout(r, 500));
				}
			}
		} catch (err) {
			console.error(`Failed to fetch Audible results for "${keyword}":`, err);
		}

		// Small delay between keyword searches
		await new Promise((r) => setTimeout(r, 500));
	}

	// Sort by release date
	return allBooks.sort(
		(a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
	);
}

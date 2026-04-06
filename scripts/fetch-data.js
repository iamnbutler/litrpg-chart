/**
 * Build-time script: fetches audiobook data from Audible API and writes
 * static JSON files to static/data/{year}.json for the current and previous year.
 */

const GENRE_SEARCHES = [
	'litrpg',
	'progression fantasy',
	'cultivation fantasy',
	'gamelit',
	'dungeon core audiobook',
	'xianxia',
	'level up fantasy',
	'isekai audiobook',
	'system apocalypse',
	'royal road audiobook',
];

/**
 * Targeted series/title searches for well-known series in the genre
 * that don't always have genre keywords in their Audible listings.
 */
/**
 * Targeted series searches for well-known series in the genre.
 * Keep search terms simple — multi-word author names cause API issues.
 */
const SERIES_SEARCHES = [
	'primal hunter',
	'he who fights with monsters',
	'wandering inn',
	'cinnamon bun',
	'beware of chicken',
	'cradle will wight',
	'path of ascension',
	'tower of somnus',
	'iron prince warformed',
	'bastion',
	'dungeon crawler carl',
	'defiance of the fall',
	'mark of the fool',
	'azarinth healer',
	'mother of learning',
	'beginning after the end',
	'legends and lattes',
	'arcane ascension',
	'divine dungeon',
	'completionist chronicles',
	'noobtown',
	'ten realms chatfield',
	'super powereds',
	'awaken online',
	'good guys ugland',
	'bad guys ugland',
	'ivil antagonist',
	'heart of dorkness',
	'beneath the dragoneye moons',
	'Jake\'s magical market',
	'mage errant',
	'forge of destiny',
	'solo leveling audiobook',
];

const AUDIBLE_API = 'https://api.audible.com/1.0/catalog/products';

const HAREM_PATTERN = /harem|haremlit|reverse\s*harem|men'?s\s*adventure|smut|erotic|\bspicy\b|adult\s*fantasy\s*romance|intimate\s*scene/i;

function isHaremOrErotic(p) {
	const text = [p.title, p.subtitle, p.merchandising_summary].filter(Boolean).join(' ');
	return HAREM_PATTERN.test(text);
}

function stripHtml(html) {
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

function formatRuntime(mins) {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h} hrs`;
	return `${h} hrs ${m} min`;
}

function guessSubgenres(product) {
	const text = [product.title, product.subtitle, product.merchandising_summary]
		.filter(Boolean).join(' ').toLowerCase();
	const subgenres = [];
	if (/litrpg|lit[\s-]?rpg|gamelit/.test(text)) subgenres.push('litrpg');
	if (/cultivation|cultivator|qi |dao |xianxia|wuxia/.test(text)) subgenres.push('cultivation');
	if (/progression\s*fantasy|level\s*up|skill\s*tree|class\s*system/.test(text)) subgenres.push('progression');
	if (/dungeon\s*core|dungeon\s*crawl/.test(text)) subgenres.push('dungeon');
	if (/isekai|transported|reincarnated|reborn\s*(in|as|into)|summoned\s*(to|into)|another\s*world/.test(text)) subgenres.push('isekai');
	if (subgenres.length === 0) subgenres.push('progression');
	return subgenres;
}

function productToBook(p) {
	const series = p.series?.[0];
	let seriesNumber = null;
	if (series?.sequence) {
		const num = parseFloat(series.sequence);
		if (!isNaN(num)) seriesNumber = num;
	}

	// Build title: use product title if available, fall back to series info
	let title = p.title;
	if (!title && series) {
		title = seriesNumber ? `${series.title} ${seriesNumber}` : series.title;
	}
	if (!title) title = 'Untitled';
	if (p.subtitle) title += `: ${p.subtitle}`;

	return {
		id: p.asin,
		title,
		series: series?.title ?? '',
		seriesNumber,
		author: (p.authors ?? []).map(a => a.name).join(', '),
		narrator: (p.narrators ?? []).map(n => n.name).join(', ') || undefined,
		releaseDate: p.publication_datetime ?? `${p.release_date}T00:00:00Z`,
		coverUrl: p.product_images?.['500'],
		audiobookLength: p.runtime_length_min ? formatRuntime(p.runtime_length_min) : undefined,
		subgenres: guessSubgenres(p),
		description: p.merchandising_summary ? stripHtml(p.merchandising_summary) : '',
		url: `https://www.audible.com/pd/${p.asin}`
	};
}

async function fetchPage(keywords, page, sort = '-ReleaseDate') {
	const params = new URLSearchParams({
		keywords,
		num_results: '50',
		page: String(page),
		response_groups: 'product_attrs,contributors,series,media,rating',
		image_sizes: '500'
	});
	if (sort) params.set('products_sort_by', sort);
	const res = await fetch(`${AUDIBLE_API}?${params}`, {
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`Audible API error: ${res.status}`);
	return res.json();
}

/**
 * Fetch a page multiple times, merge all products by ASIN.
 * The Audible API is flaky and sometimes returns partial results,
 * so we do best-of-3 and merge to maximize coverage.
 */
async function fetchPageMerged(keywords, page, sort, attempts = 3) {
	const productsByAsin = new Map();
	for (let i = 0; i < attempts; i++) {
		try {
			const data = await fetchPage(keywords, page, sort);
			for (const p of (data.products ?? [])) {
				if (!productsByAsin.has(p.asin)) {
					productsByAsin.set(p.asin, p);
				}
			}
			// If we got a full page, good enough
			if ((data.products?.length ?? 0) >= 50) break;
		} catch { /* retry */ }
		if (i < attempts - 1) await new Promise(r => setTimeout(r, 500));
	}
	return { products: [...productsByAsin.values()] };
}

async function fetchYear(year) {
	const seen = new Set();
	const books = [];

	async function processProducts(data) {
		if (!data.products) return;
		for (const p of data.products) {
			if (seen.has(p.asin)) continue;
			if (p.language !== 'english') continue;
			if (isHaremOrErotic(p)) continue;
			const releaseYear = new Date(p.release_date).getFullYear();
			if (releaseYear !== year) continue;
			seen.add(p.asin);
			books.push(productToBook(p));
		}
	}

	// Genre keyword searches: paginate deeply, sorted by date
	for (const keyword of GENRE_SEARCHES) {
		try {
			for (let page = 1; page <= 15; page++) {
				const data = await fetchPage(keyword, page, '-ReleaseDate');
				if (!data.products || data.products.length === 0) break;
				await processProducts(data);

				const last = data.products[data.products.length - 1];
				if (last && new Date(last.release_date).getFullYear() < year) break;
				await new Promise(r => setTimeout(r, 300));
			}
		} catch (err) {
			console.error(`  Failed "${keyword}":`, err.message);
		}
		await new Promise(r => setTimeout(r, 300));
	}

	// Series searches: merged best-of-3 per page (no date sort — it breaks some queries)
	for (const keyword of SERIES_SEARCHES) {
		try {
			for (let page = 1; page <= 3; page++) {
				const data = await fetchPageMerged(keyword, page, '', 3);
				if (!data.products || data.products.length === 0) break;
				await processProducts(data);

				if (data.products.length < 50) break; // last page
				await new Promise(r => setTimeout(r, 300));
			}
		} catch (err) {
			console.error(`  Failed "${keyword}":`, err.message);
		}
		await new Promise(r => setTimeout(r, 300));
	}

	books.sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
	return books;
}

const MIN_BOOKS_CURRENT_YEAR = 50;
const MIN_RATIO_VS_PREVIOUS = 0.5;

async function main() {
	const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
	const { join } = await import('node:path');

	const outDir = join(import.meta.dirname, '..', 'static', 'data');
	mkdirSync(outDir, { recursive: true });

	const currentYear = new Date().getFullYear();
	const years = [currentYear - 1, currentYear, currentYear + 1];

	for (const year of years) {
		const outPath = join(outDir, `${year}.json`);

		// Cache past years — unlikely to change, skip if already fetched
		if (year < currentYear && existsSync(outPath)) {
			console.log(`${year}: cached (skipping)`);
			continue;
		}

		console.log(`Fetching ${year}...`);
		const books = await fetchYear(year);

		// Deploy guard: validate data volume before writing
		if (year <= currentYear) {
			if (books.length < MIN_BOOKS_CURRENT_YEAR) {
				console.error(
					`DEPLOY GUARD: Only ${books.length} books fetched for ${year} (minimum: ${MIN_BOOKS_CURRENT_YEAR}). ` +
					`Aborting to prevent deploying incomplete data.`
				);
				process.exit(1);
			}

			if (existsSync(outPath)) {
				const previousBooks = JSON.parse(readFileSync(outPath, 'utf-8'));
				const previousCount = previousBooks.length;
				if (previousCount > 0 && books.length < previousCount * MIN_RATIO_VS_PREVIOUS) {
					console.error(
						`DEPLOY GUARD: Book count for ${year} dropped from ${previousCount} to ${books.length} ` +
						`(below ${MIN_RATIO_VS_PREVIOUS * 100}% threshold). ` +
						`Aborting to prevent deploying incomplete data.`
					);
					process.exit(1);
				}
			}
		}

		writeFileSync(outPath, JSON.stringify(books));
		console.log(`  ${books.length} books → ${outPath}`);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});

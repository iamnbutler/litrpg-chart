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
	return {
		id: p.asin,
		title: p.title + (p.subtitle ? `: ${p.subtitle}` : ''),
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

async function fetchPage(keywords, page) {
	const params = new URLSearchParams({
		keywords,
		num_results: '50',
		page: String(page),
		products_sort_by: '-ReleaseDate',
		response_groups: 'product_attrs,contributors,series,media,rating',
		image_sizes: '500'
	});
	const res = await fetch(`${AUDIBLE_API}?${params}`);
	if (!res.ok) throw new Error(`Audible API error: ${res.status}`);
	return res.json();
}

async function fetchYear(year) {
	const seen = new Set();
	const books = [];

	for (const keyword of GENRE_SEARCHES) {
		try {
			const maxPages = 15; // enough to cover a full year
			for (let page = 1; page <= maxPages; page++) {
				const data = await fetchPage(keyword, page);
				if (!data.products || data.products.length === 0) break;

				for (const p of data.products) {
					if (seen.has(p.asin)) continue;
					if (p.language !== 'english') continue;
					if (isHaremOrErotic(p)) continue;
					const releaseYear = new Date(p.release_date).getFullYear();
					if (releaseYear !== year) continue;
					seen.add(p.asin);
					books.push(productToBook(p));
				}

				// Stop paginating once we've passed the target year
				const last = data.products[data.products.length - 1];
				if (last && new Date(last.release_date).getFullYear() < year) break;
				await new Promise(r => setTimeout(r, 300));
			}
		} catch (err) {
			console.error(`  Failed "${keyword}":`, err.message);
		}
		await new Promise(r => setTimeout(r, 500));
	}

	books.sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
	return books;
}

async function main() {
	const { mkdirSync, writeFileSync } = await import('node:fs');
	const { join } = await import('node:path');

	const outDir = join(import.meta.dirname, '..', 'static', 'data');
	mkdirSync(outDir, { recursive: true });

	const currentYear = new Date().getFullYear();
	const years = [currentYear - 1, currentYear, currentYear + 1];

	for (const year of years) {
		console.log(`Fetching ${year}...`);
		const books = await fetchYear(year);
		const outPath = join(outDir, `${year}.json`);
		writeFileSync(outPath, JSON.stringify(books));
		console.log(`  ${books.length} books → ${outPath}`);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});

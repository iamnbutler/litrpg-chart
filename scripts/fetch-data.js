/**
 * Build-time script: fetches audiobook data from Audible API and writes
 * static JSON files to static/data/{year}.json for the current and previous year.
 *
 * Includes quality scoring to weight popular series higher and push slop down.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_DIR = join(import.meta.dirname, 'config');
const NARRATORS_CONFIG = JSON.parse(readFileSync(join(CONFIG_DIR, 'narrators.json'), 'utf-8'));
const PUBLISHERS_CONFIG = JSON.parse(readFileSync(join(CONFIG_DIR, 'publishers.json'), 'utf-8'));
const CORRECTIONS_CONFIG = JSON.parse(readFileSync(join(CONFIG_DIR, 'corrections.json'), 'utf-8'));

// Build lookup sets from config
const NARRATOR_TIER_1 = new Set(NARRATORS_CONFIG.tiers['1'].map(n => n.toLowerCase()));
const NARRATOR_TIER_2 = new Set(NARRATORS_CONFIG.tiers['2'].map(n => n.toLowerCase()));
const KNOWN_PUBLISHERS = new Set(PUBLISHERS_CONFIG.known.map(p => p.toLowerCase()));
const EXCLUDED_ASINS = new Set(Object.keys(CORRECTIONS_CONFIG.exclude ?? {}).filter(k => k !== '_comment'));

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

// --- AI Narration Detection ---

const AI_NARRATOR_PATTERNS = [
	/virtual\s*voice/i,
	/ai[\s-]?narrat/i,
	/auto[\s-]?narrat/i,
	/\bgenerated\s*voice/i,
	/text[\s-]?to[\s-]?speech/i,
];

function detectAINarration(product) {
	const narratorText = (product.narrators ?? []).map(n => n.name).join(', ');
	if (!narratorText) return true; // No narrator listed — likely AI or missing
	for (const pattern of AI_NARRATOR_PATTERNS) {
		if (pattern.test(narratorText)) return true;
	}
	return false;
}

// --- Expanded Subgenre Detection ---

function guessSubgenres(product) {
	const text = [product.title, product.subtitle, product.merchandising_summary]
		.filter(Boolean).join(' ').toLowerCase();
	const subgenres = [];
	if (/litrpg|lit[\s-]?rpg|gamelit/.test(text)) subgenres.push('litrpg');
	if (/cultivation|cultivator|qi |dao |xianxia|wuxia/.test(text)) subgenres.push('cultivation');
	if (/progression\s*fantasy|level\s*up|skill\s*tree|class\s*system/.test(text)) subgenres.push('progression');
	if (/dungeon\s*core|dungeon\s*crawl/.test(text)) subgenres.push('dungeon');
	if (/isekai|transported|reincarnated|reborn\s*(in|as|into)|summoned\s*(to|into)|another\s*world/.test(text)) subgenres.push('isekai');
	if (/tower\s*(of|climb|ascen)|climbing\s*the\s*tower|floor\s*boss/.test(text)) subgenres.push('tower');
	if (/system\s*apocalypse|apocalypse\s*system|post[\s-]?system/.test(text)) subgenres.push('system_apocalypse');
	if (/base\s*build|settlement\s*build|kingdom\s*build|town\s*build|village\s*build|fort\s*build/.test(text)) subgenres.push('base_building');
	if (/craft(ing|er|sman)|enchant(ing|er)|alchemist|blacksmith|artificer|merchant|shopkeep/.test(text)) subgenres.push('crafting');
	if (/regression|time\s*loop|rewind|second\s*chance|restart|do[\s-]?over/.test(text)) subgenres.push('regression');
	if (/monster\s*(mc|protagonist)|non[\s-]?human\s*(mc|protagonist)|evolv(e|ing)\s*monster|monster\s*evolution|\bslime\b.*\b(level|evolv)/.test(text)) subgenres.push('monster_mc');
	if (/academy|magic\s*school|mage\s*(school|university|college)|wizard\s*(school|academy)/.test(text)) subgenres.push('academy');
	if (/superhero|supervillain|super[\s-]?power(ed|s)|cape(lit|punk)/.test(text)) subgenres.push('superhero');
	if (subgenres.length === 0) subgenres.push('progression');
	return subgenres;
}

// --- Quality Scoring ---

function getNarratorTier(narratorStr) {
	if (!narratorStr) return 0;
	const lower = narratorStr.toLowerCase();
	// Check each narrator in the comma-separated list
	const narrators = lower.split(',').map(n => n.trim());
	for (const n of narrators) {
		if (NARRATOR_TIER_1.has(n)) return 1;
	}
	for (const n of narrators) {
		if (NARRATOR_TIER_2.has(n)) return 2;
	}
	return 0;
}

function computeQualityScore(book, seriesBookCounts) {
	let score = 0;

	// Rating signal (0-25 points)
	if (book.rating && book.ratingCount) {
		score += book.rating * 5; // max 25 for 5-star
	}

	// Review count signal (0-15 points)
	if (book.ratingCount && book.ratingCount > 0) {
		score += Math.min(Math.log10(book.ratingCount) * 5, 15);
	}

	// Known narrator boost (0-20 points)
	const tier = getNarratorTier(book.narrator);
	if (tier === 1) score += 20;
	else if (tier === 2) score += 12;
	else if (book.narrator && !book.isAINarrated) score += 5; // unknown human narrator

	// AI narration penalty (-30 points)
	if (book.isAINarrated) score -= 30;

	// Series popularity signal (0-10 points)
	const seriesCount = seriesBookCounts.get(book.series) ?? 0;
	if (seriesCount >= 2) score += Math.min(seriesCount * 2, 10);

	// Runtime signal: very short books are likely low-effort
	if (book.runtimeMinutes) {
		if (book.runtimeMinutes >= 300) score += 8; // 5+ hours
		else if (book.runtimeMinutes >= 180) score += 4; // 3+ hours
		else if (book.runtimeMinutes < 120) score -= 10; // under 2 hours
	}

	// No series penalty
	if (!book.series) score -= 8;

	// No cover penalty
	if (!book.coverUrl) score -= 5;

	// Known publisher boost (0-8 points)
	if (book.publisher && KNOWN_PUBLISHERS.has(book.publisher.toLowerCase())) {
		score += 8;
	}

	// Default-only subgenre penalty (no genre signals found)
	if (book.subgenres.length === 1 && book.subgenres[0] === 'progression') {
		score -= 15;
	}

	// Apply manual corrections
	const correction = CORRECTIONS_CONFIG.books?.[book.id];
	if (correction?.qualityBoost) {
		score += correction.qualityBoost;
	}

	// Clamp to 0-100
	return Math.max(0, Math.min(100, Math.round(score)));
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

	// Extract rating data (already fetched via response_groups=rating)
	const ratingObj = p.rating;
	const rating = ratingObj?.overall_distribution?.average_rating ?? undefined;
	const ratingCount = ratingObj?.overall_distribution?.num_ratings ?? ratingObj?.num_reviews ?? undefined;

	const isAINarrated = detectAINarration(p);
	const narrator = (p.narrators ?? []).map(n => n.name).join(', ') || undefined;

	return {
		id: p.asin,
		title,
		series: series?.title ?? '',
		seriesNumber,
		author: (p.authors ?? []).map(a => a.name).join(', '),
		narrator,
		releaseDate: p.publication_datetime ?? `${p.release_date}T00:00:00Z`,
		coverUrl: p.product_images?.['500'],
		audiobookLength: p.runtime_length_min ? formatRuntime(p.runtime_length_min) : undefined,
		runtimeMinutes: p.runtime_length_min ?? undefined,
		subgenres: guessSubgenres(p),
		description: p.merchandising_summary ? stripHtml(p.merchandising_summary) : '',
		url: `https://www.audible.com/pd/${p.asin}`,
		rating: rating ? parseFloat(String(rating)) : undefined,
		ratingCount: ratingCount ? parseInt(String(ratingCount), 10) : undefined,
		publisher: p.publisher_name ?? undefined,
		isAINarrated,
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
	const res = await fetch(`${AUDIBLE_API}?${params}`);
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
			if (EXCLUDED_ASINS.has(p.asin)) continue;
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

	// Compute series book counts for quality scoring
	const seriesBookCounts = new Map();
	for (const b of books) {
		if (b.series) {
			seriesBookCounts.set(b.series, (seriesBookCounts.get(b.series) ?? 0) + 1);
		}
	}

	// Apply quality scores and manual corrections
	for (const b of books) {
		const correction = CORRECTIONS_CONFIG.books?.[b.id];
		if (correction) {
			if (correction.subgenres) b.subgenres = correction.subgenres;
			if (correction.isAINarrated !== undefined) b.isAINarrated = correction.isAINarrated;
		}
		b.qualityScore = computeQualityScore(b, seriesBookCounts);
	}

	books.sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());

	// Log quality stats
	const aiCount = books.filter(b => b.isAINarrated).length;
	const defaultOnly = books.filter(b => b.subgenres.length === 1 && b.subgenres[0] === 'progression').length;
	const avgScore = books.length > 0 ? Math.round(books.reduce((s, b) => s + (b.qualityScore ?? 0), 0) / books.length) : 0;
	console.log(`  Quality: ${aiCount} AI-narrated, ${defaultOnly} default-subgenre-only, avg score ${avgScore}`);

	return books;
}

async function main() {
	const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
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
		writeFileSync(outPath, JSON.stringify(books));
		console.log(`  ${books.length} books → ${outPath}`);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});

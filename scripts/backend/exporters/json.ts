/**
 * JSON exporter: queries the canonical database and writes static JSON files
 * to static/data/{year}.json for the frontend to consume.
 *
 * Usage: npm run db:export
 * Env:   LITRPG_DB_PATH (optional, defaults to data/litrpg.db)
 */

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, initializeDatabase } from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const OUT_DIR = join(PROJECT_ROOT, 'static', 'data');
const CONFIG_PATH = join(__dirname, '..', 'config', 'export-filters.json');

// ---------- Types ----------

interface ExportFilters {
	contentFilter: {
		enabled: boolean;
		pattern: string;
		fields: string[];
	};
	qualityFilter: {
		enabled: boolean;
		minimumScore: number;
	};
	aiNarrationFilter: {
		enabled: boolean;
		qualityScoreOverride: number;
	};
	subgenreFilter: {
		enabled: boolean;
		excludeDefaultFallbackOnly: boolean;
		defaultFallback: string;
	};
}

interface DbBookRow {
	id: string;
	title: string;
	subtitle: string | null;
	author: string;
	narrator: string | null;
	release_date: string;
	cover_url: string | null;
	runtime_minutes: number | null;
	description: string;
	url: string | null;
	source: string;
	is_ai_narrated: number;
	quality_score: number | null;
	rating: number | null;
	rating_count: number | null;
	series_name: string | null;
	series_number: number | null;
	subgenres: string | null; // comma-separated from GROUP_CONCAT
}

interface ExportBook {
	id: string;
	title: string;
	series: string;
	seriesNumber: number | null;
	author: string;
	narrator?: string;
	releaseDate: string;
	coverUrl?: string;
	audiobookLength?: string;
	subgenres: string[];
	description: string;
	url?: string;
	rating?: number;
	ratingCount?: number;
}

interface YearMeta {
	totalBooks: number;
	exportedBooks: number;
}

interface ExportMeta {
	lastUpdated: string;
	years: Record<string, YearMeta>;
	sources: string[];
}

// ---------- Helpers ----------

function formatRuntime(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h} hrs`;
	return `${h} hrs ${m} min`;
}

function formatReleaseDate(dateStr: string): string {
	// If already has time component, return as-is
	if (dateStr.includes('T')) return dateStr;
	// YYYY-MM-DD → YYYY-MM-DDT00:00:00Z
	return `${dateStr}T00:00:00Z`;
}

function loadFilters(): ExportFilters {
	const raw = readFileSync(CONFIG_PATH, 'utf-8');
	return JSON.parse(raw) as ExportFilters;
}

// ---------- Query ----------

function queryBooksByYear(db: Database.Database, year: number): DbBookRow[] {
	const stmt = db.prepare(`
		SELECT
			b.id,
			b.title,
			b.subtitle,
			b.author,
			b.narrator,
			b.release_date,
			b.cover_url,
			b.runtime_minutes,
			b.description,
			b.url,
			b.source,
			b.is_ai_narrated,
			b.quality_score,
			b.rating,
			b.rating_count,
			bs.series_name,
			bs.series_number,
			sg.subgenres
		FROM books b
		LEFT JOIN (
			SELECT
				bsr.book_id,
				s.name AS series_name,
				bsr.series_number
			FROM book_series bsr
			JOIN series s ON s.id = bsr.series_id
		) bs ON bs.book_id = b.id
		LEFT JOIN (
			SELECT
				bsg.book_id,
				GROUP_CONCAT(sub.name) AS subgenres
			FROM book_subgenres bsg
			JOIN subgenres sub ON sub.id = bsg.subgenre_id
			GROUP BY bsg.book_id
		) sg ON sg.book_id = b.id
		WHERE b.release_date >= ? AND b.release_date < ?
		ORDER BY b.release_date ASC
	`);

	return stmt.all(`${year}-01-01`, `${year + 1}-01-01`) as DbBookRow[];
}

function getDistinctYears(db: Database.Database): number[] {
	const rows = db.prepare(`
		SELECT DISTINCT CAST(substr(release_date, 1, 4) AS INTEGER) AS year
		FROM books
		ORDER BY year
	`).all() as { year: number }[];
	return rows.map(r => r.year);
}

function getDistinctSources(db: Database.Database): string[] {
	const rows = db.prepare(`
		SELECT DISTINCT source FROM books ORDER BY source
	`).all() as { source: string }[];
	return rows.map(r => r.source);
}

// ---------- Filters ----------

function applyFilters(books: DbBookRow[], filters: ExportFilters): DbBookRow[] {
	let result = books;

	// Content filter (harem/erotic)
	if (filters.contentFilter.enabled) {
		const regex = new RegExp(filters.contentFilter.pattern, 'i');
		result = result.filter(book => {
			const fieldsToCheck: Record<string, string | null> = {
				title: book.title,
				subtitle: book.subtitle,
				description: book.description,
			};
			const text = filters.contentFilter.fields
				.map(f => fieldsToCheck[f])
				.filter(Boolean)
				.join(' ');
			return !regex.test(text);
		});
	}

	// AI narration filter
	if (filters.aiNarrationFilter.enabled) {
		result = result.filter(book => {
			if (!book.is_ai_narrated) return true;
			// Allow AI-narrated books with high quality score
			const score = book.quality_score ?? 0;
			return score >= filters.aiNarrationFilter.qualityScoreOverride;
		});
	}

	// Subgenre filter: exclude books with no subgenre or only default fallback
	if (filters.subgenreFilter.enabled) {
		result = result.filter(book => {
			if (!book.subgenres) return false; // no subgenres at all
			const genres = book.subgenres.split(',');
			if (filters.subgenreFilter.excludeDefaultFallbackOnly) {
				// Exclude if the only subgenre is the default fallback
				if (genres.length === 1 && genres[0] === filters.subgenreFilter.defaultFallback) {
					return false;
				}
			}
			return true;
		});
	}

	// Quality score filter
	if (filters.qualityFilter.enabled) {
		result = result.filter(book => {
			// Books without a quality score pass through (not yet scored)
			if (book.quality_score === null) return true;
			return book.quality_score >= filters.qualityFilter.minimumScore;
		});
	}

	return result;
}

// ---------- Transform ----------

function transformToFrontendShape(row: DbBookRow): ExportBook {
	let title = row.title;
	if (row.subtitle) title += `: ${row.subtitle}`;

	const subgenres = row.subgenres ? row.subgenres.split(',') : [];

	const book: ExportBook = {
		id: row.id,
		title,
		series: row.series_name ?? '',
		seriesNumber: row.series_number,
		author: row.author,
		releaseDate: formatReleaseDate(row.release_date),
		subgenres,
		description: row.description ?? '',
	};

	if (row.narrator) book.narrator = row.narrator;
	if (row.cover_url) book.coverUrl = row.cover_url;
	if (row.runtime_minutes) book.audiobookLength = formatRuntime(row.runtime_minutes);
	if (row.url) book.url = row.url;
	if (row.rating != null) book.rating = row.rating;
	if (row.rating_count != null) book.ratingCount = row.rating_count;

	return book;
}

// ---------- Main ----------

function exportJson(): void {
	const db = openDatabase();
	initializeDatabase(db);
	const filters = loadFilters();

	mkdirSync(OUT_DIR, { recursive: true });

	const years = getDistinctYears(db);
	const meta: ExportMeta = {
		lastUpdated: new Date().toISOString(),
		years: {},
		sources: getDistinctSources(db),
	};

	if (years.length === 0) {
		console.log('No data in database. Writing empty meta.json.');
		writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
		db.close();
		return;
	}

	for (const year of years) {
		const allBooks = queryBooksByYear(db, year);
		const filtered = applyFilters(allBooks, filters);
		const exported = filtered.map(transformToFrontendShape);

		const outPath = join(OUT_DIR, `${year}.json`);
		writeFileSync(outPath, JSON.stringify(exported));
		console.log(`${year}: ${allBooks.length} total → ${exported.length} exported → ${outPath}`);

		meta.years[String(year)] = {
			totalBooks: allBooks.length,
			exportedBooks: exported.length,
		};
	}

	const metaPath = join(OUT_DIR, 'meta.json');
	writeFileSync(metaPath, JSON.stringify(meta, null, 2));
	console.log(`Metadata → ${metaPath}`);

	db.close();
}

exportJson();

/**
 * Deploy guard: validates exported data files before the build proceeds.
 *
 * Checks:
 * 1. Minimum book count per year (default 100)
 * 2. Data regression vs committed version (fail if <70% of previous count)
 * 3. Required fields on every book (id, title, author, releaseDate)
 * 4. Sanity: no duplicate IDs, valid ISO dates, dates within expected year,
 *    no empty title/author
 *
 * Usage: node scripts/deploy-guard.js [--skip-guard] [--min-books=N]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DATA_DIR = join(import.meta.dirname, '..', 'static', 'data');
const REQUIRED_FIELDS = ['id', 'title', 'author', 'releaseDate'];
const DEFAULT_MIN_BOOKS = 100;
const REGRESSION_THRESHOLD = 0.7; // new count must be >= 70% of old

function parseArgs() {
	const args = process.argv.slice(2);
	let skipGuard = false;
	let minBooks = DEFAULT_MIN_BOOKS;

	for (const arg of args) {
		if (arg === '--skip-guard') skipGuard = true;
		if (arg.startsWith('--min-books=')) {
			minBooks = parseInt(arg.split('=')[1], 10);
			if (isNaN(minBooks) || minBooks < 0) minBooks = DEFAULT_MIN_BOOKS;
		}
	}
	return { skipGuard, minBooks };
}

/** Get the previously committed version of a file via git. */
function getCommittedData(filePath) {
	try {
		const relativePath = filePath.replace(
			join(import.meta.dirname, '..') + '/',
			''
		);
		const content = execSync(`git show HEAD:${relativePath}`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return JSON.parse(content);
	} catch {
		return null; // file not in git yet
	}
}

function isValidISODate(str) {
	const d = new Date(str);
	return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(str);
}

function checkYear(year, minBooks) {
	const filePath = join(DATA_DIR, `${year}.json`);
	const errors = [];
	const warnings = [];

	console.log(`\nDeploy guard: checking ${year}.json`);

	if (!existsSync(filePath)) {
		console.log(`  - File does not exist, skipping`);
		return { errors, warnings };
	}

	let books;
	try {
		books = JSON.parse(readFileSync(filePath, 'utf-8'));
	} catch (err) {
		errors.push(`Failed to parse ${year}.json: ${err.message}`);
		return { errors, warnings };
	}

	if (!Array.isArray(books)) {
		errors.push(`${year}.json is not an array`);
		return { errors, warnings };
	}

	const count = books.length;

	// --- Regression check against committed data ---
	const oldBooks = getCommittedData(filePath);
	if (oldBooks && Array.isArray(oldBooks)) {
		const oldCount = oldBooks.length;
		const ratio = oldCount > 0 ? count / oldCount : 1;
		const pctChange = oldCount > 0
			? Math.round((count - oldCount) / oldCount * 100)
			: 0;
		const sign = pctChange >= 0 ? '+' : '';

		if (ratio < REGRESSION_THRESHOLD) {
			const msg = `${count} books (previous: ${oldCount}, ${sign}${pctChange}% — BELOW ${Math.round(REGRESSION_THRESHOLD * 100)}% threshold)`;
			console.log(`  ✗ ${msg}`);
			errors.push(`Data regression detected in ${year}.json: ${msg}`);
		} else {
			console.log(`  ✓ ${count} books (previous: ${oldCount}, ${sign}${pctChange}% — within threshold)`);
		}

		// Log diff summary
		const oldIds = new Set(oldBooks.map(b => b.id));
		const newIds = new Set(books.map(b => b.id));
		const added = [...newIds].filter(id => !oldIds.has(id)).length;
		const removed = [...oldIds].filter(id => !newIds.has(id)).length;
		const retained = [...newIds].filter(id => oldIds.has(id)).length;
		console.log(`    +${added} new, -${removed} removed, ~${retained} retained`);
	} else {
		console.log(`  ✓ ${count} books (no previous data to compare)`);
	}

	// --- Minimum book count ---
	if (count < minBooks) {
		const msg = `${year}.json has only ${count} books (minimum: ${minBooks})`;
		console.log(`  ✗ ${msg}`);
		errors.push(msg);
	}

	// --- Required fields ---
	let missingFieldCount = 0;
	for (let i = 0; i < books.length; i++) {
		const book = books[i];
		for (const field of REQUIRED_FIELDS) {
			if (book[field] === undefined || book[field] === null) {
				if (missingFieldCount < 5) {
					errors.push(`${year}.json[${i}] (${book.id ?? 'unknown'}): missing required field "${field}"`);
				}
				missingFieldCount++;
			}
		}
	}
	if (missingFieldCount === 0) {
		console.log(`  ✓ All required fields present`);
	} else {
		console.log(`  ✗ ${missingFieldCount} missing required fields`);
		if (missingFieldCount > 5) {
			errors.push(`... and ${missingFieldCount - 5} more missing field errors`);
		}
	}

	// --- Duplicate IDs ---
	const idCounts = new Map();
	for (const book of books) {
		if (book.id) idCounts.set(book.id, (idCounts.get(book.id) || 0) + 1);
	}
	const dupes = [...idCounts.entries()].filter(([, c]) => c > 1);
	if (dupes.length === 0) {
		console.log(`  ✓ No duplicate IDs`);
	} else {
		console.log(`  ✗ ${dupes.length} duplicate IDs`);
		for (const [id, c] of dupes.slice(0, 5)) {
			errors.push(`${year}.json: duplicate ID "${id}" appears ${c} times`);
		}
	}

	// --- Date validation ---
	let invalidDates = 0;
	let wrongYear = 0;
	for (const book of books) {
		if (!isValidISODate(book.releaseDate)) {
			invalidDates++;
			if (invalidDates <= 3) {
				errors.push(`${year}.json: invalid date "${book.releaseDate}" for "${book.title}"`);
			}
		} else {
			const bookYear = new Date(book.releaseDate).getFullYear();
			if (bookYear !== year) {
				wrongYear++;
				if (wrongYear <= 3) {
					warnings.push(`${year}.json: date ${book.releaseDate} is year ${bookYear}, expected ${year} for "${book.title}"`);
				}
			}
		}
	}
	if (invalidDates === 0 && wrongYear === 0) {
		console.log(`  ✓ All dates valid`);
	} else {
		if (invalidDates > 0) console.log(`  ✗ ${invalidDates} invalid dates`);
		if (wrongYear > 0) console.log(`  ⚠ ${wrongYear} books with wrong year (warning)`);
	}

	// --- Empty title/author ---
	let emptyStrings = 0;
	for (const book of books) {
		if (typeof book.title === 'string' && book.title.trim() === '') {
			emptyStrings++;
			if (emptyStrings <= 3) errors.push(`${year}.json: empty title for ID "${book.id}"`);
		}
		if (typeof book.author === 'string' && book.author.trim() === '') {
			emptyStrings++;
			if (emptyStrings <= 3) errors.push(`${year}.json: empty author for ID "${book.id}"`);
		}
	}
	if (emptyStrings === 0) {
		console.log(`  ✓ No empty title/author strings`);
	} else {
		console.log(`  ✗ ${emptyStrings} empty title/author strings`);
	}

	return { errors, warnings };
}

function main() {
	const { skipGuard, minBooks } = parseArgs();

	if (skipGuard) {
		console.log('Deploy guard: skipped (--skip-guard)');
		process.exit(0);
	}

	console.log('Deploy guard: validating exported data...');

	// Find year files in data directory
	const currentYear = new Date().getFullYear();
	const years = [currentYear - 1, currentYear, currentYear + 1];
	const allErrors = [];

	for (const year of years) {
		const filePath = join(DATA_DIR, `${year}.json`);
		if (!existsSync(filePath)) continue;

		// Skip empty/trivial files (e.g. "[]" for future years)
		try {
			const books = JSON.parse(readFileSync(filePath, 'utf-8'));
			if (Array.isArray(books) && books.length === 0) {
				console.log(`\nDeploy guard: checking ${year}.json`);
				console.log(`  - Empty file, skipping validation`);
				continue;
			}
		} catch { /* will be caught in checkYear */ }

		const { errors } = checkYear(year, minBooks);
		allErrors.push(...errors);
	}

	if (allErrors.length > 0) {
		console.log('\n--- Deploy guard FAILED ---');
		for (const err of allErrors) {
			console.error(`  ERROR: ${err}`);
		}
		console.log('\nHint: Use --skip-guard to override, or investigate API failures.');
		process.exit(1);
	}

	console.log('\n--- Deploy guard passed ---');
}

main();
